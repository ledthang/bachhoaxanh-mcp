import assert from 'node:assert/strict';
import { trialLine, priceAccepted, recordPrice, acknowledgeAdd, drainPending, trialFailed, validateRemove, classifyResponse, cleanupEligible } from './cart-trial.mjs';
const line = { Id: 335195, QuantityInCart: 1, GuildId: 'test-line', Price: 6900, Total: 6900, NetUnitValue: 0 };
const payload = (item = line, off = false) => ({ HttpCode: 200, ResultCode: 0, Value: {
  TotalItemShow: off ? 0 : 1, CartTotal: { Total: off ? 0 : item.Total },
  GroupSOStep2InCart: off ? null : [{ ListCartItemBuy: [item] }],
  GroupCartOff: off ? { ListCartItemBuy: [item] } : null } });
for (const off of [false,true]) {
  assert.equal(priceAccepted(trialLine(payload(line,off))),true);
  const expensive = trialLine(payload({...line,Price:7000,Total:7000},off));
  assert.equal(priceAccepted(expensive),false);
  assert.equal(cleanupEligible({addVerified:true,line,contextUnchanged:true}),true);
}
for (const change of [{Id:1},{QuantityInCart:2},{GuildId:'bad"'},{ListGift:[{}]}])
  assert.throws(()=>trialLine(payload({...line,...change})));
const duplicate=payload();duplicate.Value.GroupCartOff={ListCartItemBuy:[line]};
assert.throws(()=>trialLine(duplicate));
const unrelated=payload();unrelated.Value.Items=[{Id:1}];assert.throws(()=>trialLine(unrelated));
const baseline={provinceId:3,districtId:0,wardId:4,storeId:5,cartId:'test-cart'};
const acknowledgement={HttpCode:200,ResultCode:0,Value:{CartId:'test-cart',Cart:{},StoreId:999}};
assert.doesNotThrow(()=>acknowledgeAdd(acknowledgement,baseline));
assert.throws(()=>trialLine(acknowledgement));
for(const invalid of [null,{...acknowledgement,HttpCode:500},{...acknowledgement,ResultCode:1},
  {...acknowledgement,Value:{CartId:'other'}}])
  assert.throws(()=>acknowledgeAdd(invalid,baseline));
const transient=payload();transient.Value.CartTotal.Total=1;
assert.equal(priceAccepted(trialLine(transient)),true);
const outcome={price_accepted:false,restored_empty:true};
assert.equal(recordPrice(outcome,line),true);
assert.equal(trialFailed(false,outcome),false);
assert.equal(recordPrice(outcome,{...line,Price:7000,Total:7000}),false);
assert.equal(recordPrice(outcome,line),false);
assert.equal(outcome.price_rejected_once,true);
assert.equal(trialFailed(false,outcome),true);
assert.equal(trialFailed(true,{restored_empty:true,price_accepted:true}),true);
assert.equal(trialFailed(false,{restored_empty:false,price_accepted:true}),true);
const pending=new Set();
let protocolFailure=false;
const later=Promise.resolve().then(()=>{
  const nested=Promise.resolve().then(()=>{
    try { acknowledgeAdd({...acknowledgement,ResultCode:1},baseline); }
    catch { protocolFailure=true; }
  });
  pending.add(nested);void nested.finally(()=>pending.delete(nested));
});
pending.add(later);void later.finally(()=>pending.delete(later));
await drainPending(pending);
assert.equal(pending.size,0);
assert.equal(protocolFailure,true);
assert.equal(trialFailed(protocolFailure,{restored_empty:true,price_accepted:true}),true);
const body={token:'',us:'',provinceId:3,districtId:0,wardId:4,storeId:5,isNewModel:true,
  data:{cartId:'test-cart',guid:'test-line',reloadShiping:true,isSubmitOrder:false,productId:335195,wardId:4}};
assert.equal(validateRemove(JSON.stringify(body),baseline,line.GuildId),true);
for(const change of [{wardId:9},{guid:'other'},{productId:1},{isSubmitOrder:true}])
  assert.equal(validateRemove(JSON.stringify({...body,data:{...body.data,...change}}),baseline,line.GuildId),false);
const missing=structuredClone(body);delete missing.data.wardId;
assert.equal(validateRemove(JSON.stringify(missing),baseline,line.GuildId),false);
const stale={},fresh={},add={},remove={};
const state={reads:new WeakMap(),epoch:0,applied:0};
state.reads.set(stale,{phase:'baseline',epoch:0,sequence:1});
assert.equal(classifyResponse(stale,state),'baseline');
state.addRequest=add;state.epoch++;
assert.equal(classifyResponse(stale,state),'ignore');assert.equal(classifyResponse(add,state),'add');
state.reads.set(fresh,{phase:'trial',epoch:1,sequence:2});
assert.equal(classifyResponse(fresh,state),'trial');state.applied=3;
assert.equal(classifyResponse(fresh,state),'ignore');
state.removeRequest=remove;state.epoch++;
assert.equal(classifyResponse(add,state),'ignore');assert.equal(classifyResponse(remove,state),'remove');
state.removeSucceeded=true;state.epoch++;
assert.equal(classifyResponse(remove,state),'ignore');
state.reads.set(fresh,{phase:'fresh',epoch:state.epoch,sequence:4});
assert.equal(classifyResponse(fresh,state),'fresh');
for(const change of [{unsafe:true},{contextUnchanged:false},{removeRequest:{}}])
  assert.equal(cleanupEligible({addVerified:true,line,contextUnchanged:true,...change}),false);
console.log('cart-trial offline checks passed');
