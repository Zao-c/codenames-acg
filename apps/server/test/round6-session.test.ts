import assert from 'node:assert/strict';
import type { ClientSession } from '@acg-codenames/shared';
import { saveIdentity, saveSession, loadSession, saveRecoverableSessions, loadRecoverableSessions, invalidateRoomSession, roomInvalidationKey } from '../../web/src/lib/storage';

const values = new Map<string,string>();
Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},configurable:true});
const identity={mode:'guest' as const,username:'',nickname:'round6',avatarUrl:null};
saveIdentity(identity);
const session=(roomId:string):ClientSession=>({roomId,playerId:'p',participantId:'p',participantType:'player',sessionToken:`token-${roomId}`});
saveSession(session('BBBBBB'));
saveRecoverableSessions({AAAAAA:{sessionToken:'old-a',savedAt:1},BBBBBB:{sessionToken:'valid-b',savedAt:2}});
invalidateRoomSession('AAAAAA');
assert.equal(loadSession()?.roomId,'BBBBBB','late A close must preserve current B');
assert.deepEqual(Object.keys(loadRecoverableSessions()),['BBBBBB']);
const notification=JSON.parse(values.get(roomInvalidationKey())!);
assert.equal(notification.roomId,'AAAAAA','other tabs learn the precise invalid room');
invalidateRoomSession('BBBBBB');
assert.equal(loadSession(),null);
assert.deepEqual(loadRecoverableSessions(),{});

// Changing accounts must not invalidate the other account's seat/recovery key.
saveSession(session('CCCCCC'));
saveRecoverableSessions({CCCCCC:{sessionToken:'c',savedAt:3}});
saveIdentity({...identity,nickname:'other'});
invalidateRoomSession('CCCCCC');
saveIdentity(identity);
assert.equal(loadSession()?.roomId,'CCCCCC');
assert.ok(loadRecoverableSessions().CCCCCC);
console.log('round6 sessions: precise room invalidation, cross-tab payload and account isolation PASS');
