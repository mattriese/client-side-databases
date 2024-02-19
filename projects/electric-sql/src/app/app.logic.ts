import { collectionData } from 'rxfire/firestore';
import { Observable, combineLatest, from } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  mergeMap,
  shareReplay,
  switchMap,
} from 'rxjs/operators';
import { LogicInterface } from '../../../../src/app/logic-interface.interface';
import {
  AddMessage,
  Message,
  Search,
  User,
  UserPair,
  UserWithLastMessage,
} from '../../../../src/shared/types';

import {
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';

import { RXJS_SHARE_REPLAY_DEFAULTS } from 'rxdb';
import {
  sortByNewestFirst,
  sortMessagesByDateNewestFirst,
} from 'src/shared/util-server';
import { Electric } from './generated/client';
import { ElectricService } from './services/electric.service';

export class Logic implements LogicInterface {
  private electric: Electric;
  constructor(private electricService: ElectricService) {
    this.init();
  }

  async init() {
    this.electric = this.electricService.getDb();
  }

  getUserByName(userName$: Observable<string>): Observable<User> {
    return userName$.pipe(
      mergeMap((userName) =>
        from(
          this.electric.db.users.findUnique({
            where: {
              id: userName,
            },
          })
        ).pipe(
          map((user) =>
            user
              ? {
                  id: user.id,
                  createdAt: Number(user.created_at), // Convert BigInt to number
                }
              : null
          ),
          filter((user): user is User => user !== null)
        )
      )
    );
  }
  getSearchResults(
    search$: Observable<Search>
  ): Observable<UserWithLastMessage[]> {
    return search$.pipe(
      mergeMap((search) => {
        const regex = new RegExp(search.searchTerm, 'i');
        return combineLatest([
          collectionData(
            query(
              this.messages,
              where('sender', '==', search.ownUser.id),
              orderBy('createdAt', 'desc')
            )
          ),
          collectionData(
            query(
              this.messages,
              where('reciever', '==', search.ownUser.id),
              orderBy('createdAt', 'desc')
            )
          ),
        ]).pipe(
          map(([ar1, ar2]: any) => {
            const ret: Message[] = ar1.concat(ar2);
            return ret;
          }),
          /**
           * Firebase emits the result of the above collectionData() multiple times,
           * even if nothing has changed. So we have to filter out
           * the non-first emits to not trigger the search multiple times.
           */
          distinctUntilChanged((prev: any[], curr: any[]) => {
            return prev.length === curr.length;
          }),
          map((messages) =>
            messages.filter((message) => regex.test(message.text))
          ),
          switchMap((messages) => {
            return Promise.all(
              messages.map(async (messageDoc) => {
                let otherUser = messageDoc.sender;
                if (otherUser === search.ownUser.id) {
                  otherUser = messageDoc.reciever;
                }
                const docRef = doc(this.users, otherUser);
                const userDoc = await getDoc(docRef);
                const user: User = userDoc.data() as any;
                const ret: UserWithLastMessage = {
                  user,
                  message: messageDoc,
                };
                return ret;
              })
            );
          })
        );
      })
    );
  }
  getUsersWithLastMessages(
    ownUser$: Observable<User>
  ): Observable<UserWithLastMessage[]> {
    const usersNotOwn$ = ownUser$.pipe(
      switchMap((ownUser) => {
        return collectionData(this.users).pipe(
          map((users: User[]) => {
            /**
             * because firestore does not allow a $ne-query,
             * we have to filter by hand
             */
            return users.filter((user) => user.id !== ownUser.id);
          }) as any // TODO fix typings
        );
      }),
      shareReplay(RXJS_SHARE_REPLAY_DEFAULTS)
    );

    const usersWithLastMessage$: Observable<Observable<UserWithLastMessage>[]> =
      combineLatest([ownUser$, usersNotOwn$]).pipe(
        map(([ownUser, usersNotOwn]) => {
          return (usersNotOwn as User[]).map((user) => {
            const pair: UserPair = {
              user1: ownUser,
              user2: user,
            };
            const ret2 = this.getLastMessageOfUserPair(pair).pipe(
              map((message) => {
                return {
                  user,
                  message: message ? message : undefined,
                };
              }),
              shareReplay(RXJS_SHARE_REPLAY_DEFAULTS)
            );
            return ret2;
          });
        })
      );

    const ret: Observable<UserWithLastMessage[]> = usersWithLastMessage$.pipe(
      switchMap((usersWithLastMessage) => {
        return combineLatest(usersWithLastMessage);
      }),
      map((usersWithLastMessage) => sortByNewestFirst(usersWithLastMessage))
    );
    return ret;
  }
  private getLastMessageOfUserPair(
    userPair: UserPair
  ): Observable<Message | null> {
    /**
     * because firestore does not allow OR-queries,
     * we have to merge both results and pick the newest message
     */
    return combineLatest([
      collectionData(
        query(
          this.messages,
          where('sender', '==', userPair.user1.id),
          where('reciever', '==', userPair.user2.id),
          orderBy('createdAt', 'desc'),
          limit(1)
        )
      ),
      collectionData(
        query(
          this.messages,
          where('sender', '==', userPair.user2.id),
          where('reciever', '==', userPair.user1.id),
          orderBy('createdAt', 'desc'),
          limit(1)
        )
      ),
    ]).pipe(
      /**
       * return the newest of both messages
       */
      map(([[r1], [r2]]) => {
        const messages = [r1, r2] as any;
        const newest = sortMessagesByDateNewestFirst(
          messages.filter((m: any) => !!m)
        );
        return newest[0];
      }),
      distinctUntilChanged((m1, m2) => m1.id === m2.id),
      shareReplay(RXJS_SHARE_REPLAY_DEFAULTS)
    );
  }
  getMessagesForUserPair(
    userPair$: Observable<UserPair>
  ): Observable<Message[]> {
    return userPair$.pipe(
      switchMap((userPair) =>
        combineLatest([
          collectionData(
            query(
              this.messages,
              where('sender', '==', userPair.user1.id),
              where('reciever', '==', userPair.user2.id),
              orderBy('createdAt', 'desc')
            )
          ),
          collectionData(
            query(
              this.messages,
              where('sender', '==', userPair.user2.id),
              where('reciever', '==', userPair.user1.id),
              orderBy('createdAt', 'desc')
            )
          ),
        ])
      ),
      map(([ar1, ar2]: any) => {
        const all = ar1.concat(ar2);
        const sorted = sortMessagesByDateNewestFirst(all);
        return sorted.reverse();
      })
    );
  }
  async addMessage(message: AddMessage): Promise<void> {
    const docRef = doc(this.messages, message.message.id);
    const insert = await setDoc(docRef, message.message);
    return insert;
  }

  async addUser(user: User): Promise<any> {
    const docRef = doc(this.users, user.id);
    const insert = await setDoc(docRef, user);
    return insert;
  }

  async hasData(): Promise<boolean> {
    const docs = await getDocs(query(this.users, limit(1)));
    return docs.size > 0;
  }
}
