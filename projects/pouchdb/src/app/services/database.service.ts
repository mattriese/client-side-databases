import * as PouchDBModule from 'pouchdb-core';
import * as PouchDbFindModule from 'pouchdb-find';
import * as PouchDbAdapterIndexedDb from 'pouchdb-adapter-idb';
import * as PouchReplicationPlugin from 'pouchdb-replication';
import * as PouchdbAdapterHttp from 'pouchdb-adapter-http';

const PouchDB = (PouchDBModule as any)['default'];
PouchDB.plugin((PouchDbFindModule as any)['default']);
PouchDB.plugin((PouchDbAdapterIndexedDb as any)['default']);
PouchDB.plugin((PouchReplicationPlugin as any)['default']);
PouchDB.plugin((PouchdbAdapterHttp as any)['default']);


// import * as PouchdbDebug from 'pouchdb-debug';
// PouchDB.plugin(PouchdbDebug['default']);
// PouchDB.debug.enable('pouchdb:find');


import { shareReplay } from 'rxjs/operators';

import {
    COUCHDB_PATH
} from '../shared';
import { doReplication, logTime } from 'src/shared/util-browser';
import { Observable, Subject } from 'rxjs';
import { RXJS_SHARE_REPLAY_DEFAULTS } from 'rxdb';

export interface DatabaseType {
    users: any;
    messages: any;
    users$: Observable<any>;
    messages$: Observable<any>;
}

/**
 * creates the database
 */
export async function createDatabase(): Promise<DatabaseType> {
    logTime('createDatabase()');

    const pouchDbUsers: any = new PouchDB(
        'users',
        {
            adapter: 'idb'
        }
    );
    const pouchDbMessages: any = new PouchDB(
        'messages',
        {
            adapter: 'idb'
        }
    );

    // create indexes
    logTime('create index');
    await pouchDbMessages.createIndex({
        name: 'createdAtIndex',
        ddoc: 'createdAtIndex',
        index: {
            fields: ['createdAt']
        }
    });
    logTime('create index DONE');


    // sync with server
    if (doReplication()) {
        pouchDbUsers.sync(
            COUCHDB_PATH + 'users',
            {
                live: true
            }
        );
        pouchDbMessages.sync(
            COUCHDB_PATH + 'messages',
            {
                live: true
            }
        );
    }

    logTime('createDatabase() DONE');
    return {
        users: pouchDbUsers,
        messages: pouchDbMessages,
        users$: getChangeFeed(pouchDbUsers),
        messages$: getChangeFeed(pouchDbMessages)
    };
}

export function getChangeFeed(pouchdb: any): Observable<any> {
    const subject = new Subject();
    const changes = pouchdb.changes({
        since: 'now',
        live: true,
        include_docs: true
    });
    changes.on('change', (change: any) => {
        // received a change
        subject.next(change);
    });
    changes.on('error', (err: Error) => {
        // handle errors
        subject.error(err);
    });
    return subject.asObservable().pipe(
        shareReplay(RXJS_SHARE_REPLAY_DEFAULTS)
    );
}
