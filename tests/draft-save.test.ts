import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DraftSaver,type DraftValue } from '../src/draft-save.ts';
const remote={id:'q',answer:'',images:[],revision:0,updatedAt:''};

test('shared draft queue preserves latest edits when leaving and reopening while a save is pending',async()=>{
  let release!:()=>void;const gate=new Promise<void>(r=>release=r),sent:DraftValue[]=[];
  const saver=new DraftSaver(async(id,value)=>{sent.push(value);if(sent.length===1)await gate;return {...value,id,updatedAt:''};});
  saver.open('q',remote);
  const first=saver.edit('q',{answer:'第一稿',images:[]}),saving=saver.save('q',first);
  const second=saver.edit('q',{answer:'离页前最后输入',images:[]}),leaving=saver.save('q',second);
  await Promise.resolve();assert.ok(saver.pending('q'));
  release();await Promise.all([saving,leaving,saver.settle('q')]);
  assert.deepEqual(sent.map(v=>v.answer),['第一稿','离页前最后输入']);
  assert.equal(saver.pending('q'),undefined);
  assert.equal(saver.open('q',{...remote,...second}).answer,'离页前最后输入');
  assert.ok(saver.edit('q',{answer:'返回后输入',images:[]}).revision>second.revision);
});

test('failed saves remain recoverable on remount and later saves still execute',async()=>{
  let fail=true;const saver=new DraftSaver(async(id,value)=>{if(fail)throw new Error('offline');return {...value,id,updatedAt:''};});
  saver.open('q',remote);const value=saver.edit('q',{answer:'不能丢的内容',images:['image']});
  await assert.rejects(saver.save('q',value));await saver.settle('q');
  assert.deepEqual(saver.open('q',remote),value);
  fail=false;await saver.save('q',value);assert.equal(saver.pending('q'),undefined);
});
