import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// Real cart writes. Explicit opt-in; no checkout, blind retry or uncertain cleanup.
assert.equal(process.env.BHX_APPROVED_CART_TRIAL,'1','Set BHX_APPROVED_CART_TRIAL=1 only for an authorized live trial');
const child=spawn(process.execPath,['src/server.mjs'],{stdio:['pipe','pipe','inherit']});
const pending=new Map();let sequence=0;
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{const reply=JSON.parse(line);const item=pending.get(reply.id);if(item){pending.delete(reply.id);clearTimeout(item.timer);item.resolve(reply);}});
child.on('exit',()=>{for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('MCP exited'));}pending.clear();});
function call(method,params){
 const id=++sequence;
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP_TIMEOUT: inspect cart; no automatic retry'));},90000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,...(params?{params}:{})})+'\n');});
}
async function tool(name,args={}){
 const r=await call('tools/call',{name,arguments:args});
 assert.ok(!r.error&&!r.result?.isError,`${name}: unverified; inspect cart before any retry`);
 return JSON.parse(r.result.content[0].text);
}
try{
 assert.ok((await call('initialize')).result);
 const added=await tool('bhx_add_to_cart',{product_id:335195,quantity:1,max_unit_price_vnd:6900,user_authorized:true});
 assert.equal(added.items[0].quantity,1);const line_id=added.items[0].line_id;
 console.log('MCP_ADD_PASS');
 const updated=await tool('bhx_update_cart_item',{line_id,quantity:2,user_authorized:true});
 assert.equal(updated.items[0].quantity,2);console.log('MCP_UPDATE_PASS');
 const read=await tool('bhx_get_cart');assert.equal(read.items.length,1);assert.equal(read.items[0].quantity,2);assert.equal(read.context.verified,true);console.log('MCP_READ_AFTER_WRITE_PASS');
 const removed=await tool('bhx_remove_cart_item',{line_id,user_authorized:true});assert.deepEqual(removed.items,[]);console.log('MCP_REMOVE_PASS');
 const empty=await tool('bhx_get_cart');assert.deepEqual(empty.items,[]);console.log('MCP_FRESH_EMPTY_PASS');
}finally{
 child.stdin.end();
 const timer=setTimeout(()=>child.kill('SIGTERM'),10000);timer.unref();
 await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);});clearTimeout(timer);lines.close();
}
