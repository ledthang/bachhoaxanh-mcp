import assert from 'node:assert/strict';
import { validateAddressInput, selectionAllowed } from '../src/delivery.mjs';
for(const input of [null,{},[],{address_id:1},{address_id:'01'},{address_id:'1',extra:true},{address_id:'1\n'}])assert.throws(()=>validateAddressInput(input));
assert.equal(validateAddressInput({address_id:'12'}),'12');
assert.equal(selectionAllowed('https://api.bachhoaxanh.com/gw/cart/api/OrderV2/SelectProfile','POST',{},null),false);
assert.equal(selectionAllowed('https://api.bachhoaxanh.com/gw/cart/api/OrderV2/Add','POST',{},{}),false);
const baseline={cartId:'cart',provinceId:1,districtId:0,wardId:2,storeId:3,address:{addressId:12,provinceId:1,wardId:2,lat:'10',lng:'106'}};
baseline.address.districtId=4;
const body={data:{CartId:'cart',Lat:10,Lng:106,ProfileDetailId:12,ProfileDetailIds:[],wardId:2},provinceId:1,districtId:4,wardId:2,storeId:3,isNewModel:true}; assert.equal(selectionAllowed('https://api.bachhoaxanh.com/gw/cart/api/OrderV2/SelectProfile','POST',body,baseline),true);
const url='https://api.bachhoaxanh.com/gw/cart/api/OrderV2/SelectProfile';
assert.equal(selectionAllowed(url,'POST',body,baseline),true);
for(const bad of [{...body,isSubmitOrder:true},{...body,data:{...body.data,ProfileDetailId:13}},{...body,storeId:0},{...body,data:{...body.data,ProfileDetailIds:[12]}}])assert.equal(selectionAllowed(url,'POST',bad,baseline),false);
const {selectAddress}=await import('../src/delivery.mjs');
// Cross-address: current context is store 14524/ward 101462; target id 110346409 resolves to store 14509/ward 101469.
const fixture={authenticated:true,requires_login:false,addresses:[{id:'12',selected:true}],context:{address_id:'12',province_id:'1',ward_id:'2',store_id:'3',verified:true},cart:{items:[]}};
let writes=0;
const result=await selectAddress({address_id:'12'},async()=>structuredClone(fixture),async()=>{writes++;});
assert.equal(writes,1);assert.equal(result.selection_status,'selected-and-restarted');
// cross-address switch: target was not selected -> changed:true must be reported
const fixture2={authenticated:true,requires_login:false,addresses:[{id:'12',selected:true},{id:'99',selected:false}],context:{address_id:'12',province_id:'1',ward_id:'2',store_id:'3',verified:true},cart:{items:[]}};
const fixture2After={authenticated:true,requires_login:false,addresses:[{id:'12',selected:false},{id:'99',selected:true}],context:{address_id:'99',province_id:'1',ward_id:'2',store_id:'7',verified:true},cart:{items:[]}};
let seq=0;
const switchSnapshot=async()=>structuredClone(seq++===0?fixture2:fixture2After);
const switched=await selectAddress({address_id:'99'},switchSnapshot,async()=>{});
assert.equal(switched.selected,true);assert.equal(switched.changed,true);
// select already-selected address -> changed:false
seq=0;
const sameSelected=await selectAddress({address_id:'12'},async()=>structuredClone(fixture),async()=>{});
assert.equal(sameSelected.changed,false);
console.log('PASS: delivery input, exact selection guard, cross-address switch');
