'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {parse,commit}=require('../public/number-input');
test('clearing a number does not silently turn it into zero',()=>{assert.equal(parse(''),null);assert.equal(parse('.'),null);assert.equal(parse('-'),null);assert.equal(commit('',7,1,25,.1),7);});
test('normalizes leading zeros and full width input on commit',()=>{assert.equal(commit('020',7,1,25,.1),20);assert.equal(commit('００２．５',7,1,25,.1),2.5);assert.equal(commit('-0',0,0,100,.1),0);});
test('decimal editing, limits and precision remain valid',()=>{assert.equal(parse('1.'),1);assert.equal(parse('.5'),.5);assert.equal(commit('100',7,1,25,.1),25);assert.equal(commit('0',7,1,25,.1),1);assert.equal(commit('1.26',7,1,25,.1),1.3);assert.equal(commit('2.6',0,0,9999,1),3);assert.equal(commit('80',0,0,40,.1),40);});
test('rejects non numeric and overflowing input',()=>{for(const raw of ['NaN','Infinity','1e99','hello','1.2.3'])assert.equal(parse(raw),null);assert.equal(commit('invalid',8,1,120,.1),8);});
