/* This is an example of an SQL DDL migration. It creates an `items` table and
 * then calls an `electric.electrify` procedure to expose the table to the
 * ElectricSQL replication machinery.
 *
 * Note that these statements are applied directly to the *Postgres* database.
 * Electric then handles keeping the local SQLite database schema in sync with
 * the electrified subset of your Postgres database schema.
 *
 * See https://electric-sql.com/docs/usage/data-modelling for more information.
 */

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR PRIMARY KEY,
    created_at BIGINT NOT NULL
);

-- ⚡
-- Electrify the items table
ALTER TABLE users ENABLE ELECTRIC;

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    text TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    read BOOLEAN NOT NULL,
    sender VARCHAR NOT NULL,
    reciever VARCHAR NOT NULL,
    FOREIGN KEY (sender) REFERENCES users(id),
    FOREIGN KEY (reciever) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

ALTER TABLE messages ENABLE ELECTRIC;
