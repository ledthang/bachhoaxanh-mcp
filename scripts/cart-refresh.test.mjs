import assert from 'node:assert/strict';
import { validateRefresh } from './cart-refresh.mjs';
const baseline={provinceId:3,districtId:0,wardId:4,storeId:5,cartId:'offline-cart'};
const body={token:'offline',us:'',provinceId:3,districtId:0,wardId:4,storeId:5,isNewModel:true,
  data:{cartId:'offline-cart',infoApp:'webnew',wardId:4}};
assert.equal(validateRefresh(JSON.stringify(body),baseline),true);
for(const change of [{wardId:9},{storeId:8},{extra:1},{isNewModel:false},
  {data:{...body.data,cartId:'other'}},{data:{...body.data,wardId:9}},
  {data:{...body.data,infoApp:'other'}},{data:{...body.data,extra:1}}])
  assert.equal(validateRefresh(JSON.stringify({...body,...change}),baseline),false);
for(const raw of ['null','[]','{}','{',JSON.stringify(body).replace('"us":""','"us":"","us":""')])
  assert.equal(validateRefresh(raw,baseline),false);
assert.equal(validateRefresh(JSON.stringify(body),undefined),false);
console.log('PASS: offline exact cart refresh request contract.');
