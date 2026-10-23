'use strict';
const assert = require('node:assert/strict');
const { LastCardGame } = require('../game/lastcard');
const game = () => new LastCardGame([{id:'a',name:'Alice'},{id:'b',name:'Bob'},{id:'c',name:'Cara'}]);
function ready(g) { g.hands.a = [{id:'held',color:'red',value:'1'}]; g.pendingShoutId='a'; g.catchDeadline=Date.now()+4000; }
{
 const g=game(); ready(g); const before=g.hands.a.length;
 assert.equal(g.catch('a').ok,false,'offender cannot catch themselves');
 assert.equal(g.catch('intruder').ok,false,'non-player cannot catch');
 assert.equal(g.catch('b').ok,true,'eligible opponent catches');
 assert.equal(g.hands.a.length,before+2,'two cards awarded');
 assert.equal(g.catch('c').ok,false,'duplicate catch rejected');
}
{
 const g=game(); ready(g); assert.equal(g.shout('a').ok,true);
 assert.equal(g.catch('b').ok,false,'a timely Last Card shout wins the race');
}
{
 const g=game(); ready(g); g.catchDeadline=Date.now()-1;
 assert.equal(g.catch('b').ok,false,'expired catch rejected');
 assert.equal(g.hands.a.length,1,'no expired penalty');
}
{
 const g=game(); ready(g); g.hands.a.push({id:'second',color:'blue',value:'2'});
 assert.equal(g.catch('b').ok,false,'cannot catch a two-card hand');
}
console.log('CATCH! live rules tests passed');
