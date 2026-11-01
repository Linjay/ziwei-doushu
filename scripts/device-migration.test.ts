import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { database } from '../lib/server/database';
import { currentUser } from '../lib/server/auth';
const root=path.resolve('.codex-local');mkdirSync(root,{recursive:true});const directory=mkdtempSync(path.join(root,'device-migration-'));
const old=new DatabaseSync(path.join(directory,'mingli.sqlite')),token='b'.repeat(64),payload='{"historical":"preserve this byte for byte"}';
old.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,profile TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,active_record TEXT); CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL); CREATE TABLE chart_records(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,record_id TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,record_id));');
old.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('existing','original','old-hash','{"displayName":"原有用户"}',1,2,'original-record');
old.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),'existing',Date.now()+60000);
old.prepare('INSERT INTO chart_records VALUES(?,?,?,?)').run('existing','original-record',payload,3);old.close();process.env.MINGLI_DATA_DIR=directory;
after(()=>{database().close();if(path.dirname(directory)!==root||!path.basename(directory).startsWith('device-migration-'))throw new Error('Unsafe cleanup');rmSync(directory,{recursive:true,force:true});});
test('upgrading a real previous schema preserves existing accounts, session cookies and record payloads',()=>{
  const db=database(),user=currentUser(new Request('https://mingli.linjay.fun:16666/api/auth/me',{headers:{Cookie:'mingli_session='+token}}));
  assert.equal(user?.id,'existing');assert.equal(user?.isGuest,false);assert.equal(user?.usesInitialPassword,false);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id=?').get('existing')?.password_hash,'old-hash');
  assert.equal(db.prepare('SELECT payload FROM chart_records WHERE user_id=?').get('existing')?.payload,payload);
  assert.equal(db.prepare('SELECT count(*) n FROM remembered_devices').get()?.n,0);
});
test('schema initialization is idempotent and keeps all foreign keys consistent',()=>{
  const db=database();assert.equal(database(),db);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('PRAGMA table_info(sessions)').all().filter(row=>row.name==='device_id').length,1);
});
