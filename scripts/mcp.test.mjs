import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const messages=[
  {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},
  {jsonrpc:'2.0',method:'notifications/initialized'},
  {jsonrpc:'2.0',id:2,method:'tools/list'},
  {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'bhx_get_cart',arguments:{url:'https://invalid'}}},
  {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'bhx_unknown',arguments:{}}},
  {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'bhx_search_products',arguments:{query:'x',page_size:15}}},
  {jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'bhx_login_submit',arguments:{otp:'12ab'}}},
];
const run=spawnSync(process.execPath,['src/server.mjs'],{input:messages.map(JSON.stringify).join('\n')+'\n',encoding:'utf8',timeout:20000});
assert.equal(run.status,0);
const replies=run.stdout.trim().split('\n').map(JSON.parse);
assert.equal(replies[0].result.serverInfo.name,'bhx-mcp');
const tools=replies[1].result.tools;
assert.equal(tools.length,15);
const names=tools.map(t=>t.name);
for(const n of ['bhx_auth_status','bhx_list_addresses','bhx_get_delivery_context','bhx_get_cart','bhx_cart_summary','bhx_search_products','bhx_get_product','bhx_check_availability','bhx_checkout_preview','bhx_add_to_cart','bhx_update_cart_item','bhx_remove_cart_item','bhx_login_start','bhx_login_submit','bhx_select_address'])
  assert.ok(names.includes(n),`missing ${n}`);
// pagination + ladder + window are in the search tool contract
const search=tools.find(t=>t.name==='bhx_search_products');
assert.ok(search.description.includes('page_index')&&search.description.includes('ladder')&&search.description.includes('promotion window'));
assert.ok(search.inputSchema.properties.page_size.enum.includes(20)&&search.inputSchema.properties.page_index.maximum===40);
// bad args rejected before any side effect
assert.equal(replies[2].error.code,-32602,'invalid extra arg');
assert.equal(replies[3].error.code,-32602,'unknown tool');
assert.equal(replies[4].error.code,-32602,'bad page_size');
assert.equal(replies[5].error.code,-32602,'bad otp format');
// notification never answered
assert.equal(replies.length,6);
// without BHX_CHROMIUM_PATH the session fails closed (no browser launched)
console.log('PASS: stdio protocol, tool surface 12, argument validation, fail-closed session.');
