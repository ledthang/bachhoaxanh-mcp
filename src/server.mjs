import { createInterface } from 'node:readline';
import { readSnapshot } from './browser.mjs';
import { pathToFileURL } from 'node:url';
import { createCartSession, validateMutation } from './cart-mutations.mjs';
const mutationNames = ['bhx_add_to_cart', 'bhx_update_cart_item', 'bhx_remove_cart_item'];
const names=['bhx_auth_status','bhx_list_addresses','bhx_get_delivery_context','bhx_get_cart','bhx_cart_summary','bhx_search_products'];
const tools=names.map(name=>({name,description:'Read authenticated BHX state. No checkout or payment. Catalog price is not guaranteed payable price.',inputSchema:{type:'object',properties:name==='bhx_search_products'?{query:{type:'string',minLength:1,maxLength:100}}:{},required:name==='bhx_search_products'?['query']:[],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}));
for (const name of mutationNames) tools.push({name,description:'Explicitly authorized, bounded cart mutation. Only product 335195 variant 1 scenario 0; Add quantity 1 into empty cart, update runtime-owned line 1 to 2, remove runtime-owned line. No checkout/payment. Uncertain results require manual inspection; never retry blindly.',inputSchema:{type:'object',properties:{user_authorized:{type:'boolean',const:true},...(name==='bhx_add_to_cart'?{product_id:{type:'integer',const:335195},quantity:{type:'integer',const:1},max_unit_price_vnd:{type:'integer',minimum:1}}:{line_id:{type:'string',minLength:1,maxLength:200},...(name==='bhx_update_cart_item'?{quantity:{type:'integer',const:2}}:{})})},required:name==='bhx_add_to_cart'?['user_authorized','product_id','quantity','max_unit_price_vnd']:name==='bhx_update_cart_item'?['user_authorized','line_id','quantity']:['user_authorized','line_id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}});
export function createHandler({sessionFactory=createCartSession, snapshotReader=readSnapshot}={}) {
let initialized=false, session;
async function handle(m){
 if(!m||m.jsonrpc!=='2.0'||typeof m.method!=='string')throw {code:-32600,message:'Invalid Request'};
 if(m.method==='initialize'){initialized=true;return {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'bhx-mcp',version:'0.1.0'}};}
 if(m.method==='notifications/initialized')return;
 if(m.method==='ping')return {};
 if(!initialized)throw {code:-32000,message:'Initialize first'};
 if(m.method==='tools/list')return {tools};
 if(m.method!=='tools/call')throw {code:-32601,message:'Method not found'};
 const {name,arguments:args={}}=m.params||{};
 if(mutationNames.includes(name)) {
  if(!Object.hasOwn(m,'id')||!(typeof m.id==='string'||Number.isSafeInteger(m.id)))throw {code:-32600,message:'Mutation requires request id'};
  try { validateMutation(name,args); } catch(error) { throw {code:-32602,message:error.message}; }
  try { session ??= await sessionFactory(); const data=await session.mutate(name,args); return {content:[{type:'text',text:JSON.stringify(data)}]}; }
  catch { return {isError:true,content:[{type:'text',text:'BHX_MUTATION_UNVERIFIED: mutation may have applied. No automatic retry or cleanup. Inspect cart. Only proven product/quantity and runtime-owned lines supported.'}]}; }
 }
 if(!names.includes(name)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>name!=='bhx_search_products'||k!=='query')||(name==='bhx_search_products'&&(typeof args.query!=='string'||args.query.length<1||args.query.length>100||/[\p{Cc}\p{Cf}]/u.test(args.query))))throw {code:-32602,message:'Invalid tool arguments'};
 try{
  if(session && ['bhx_get_cart','bhx_cart_summary'].includes(name)){const data=await session.readCart();return {content:[{type:'text',text:JSON.stringify(data)}]};}
  if(session) throw Error('Dedicated mutation context active; separate read browser cannot acquire profile');
  const s=await snapshotReader(args.query,name==='bhx_search_products');
  const data=name==='bhx_auth_status'?{authenticated:s.authenticated,session_status:s.session_status,requires_login:s.requires_login}:name==='bhx_list_addresses'?{addresses:s.addresses}:name==='bhx_get_delivery_context'?s.context:name==='bhx_search_products'?{products:s.products,context:s.context,limit:3,price_status:'catalog-observed-not-guaranteed-payable'}:{...s.cart,context:s.context};
  return {content:[{type:'text',text:JSON.stringify({...data,observed_at:s.observed_at})}]};
 }catch{return {isError:true,content:[{type:'text',text:'BHX_READ_UNVERIFIED: session, selected address or response could not be verified. No cart mutation performed.'}]};}
}
return {handle,close:async()=>session?.close()};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
const {handle,close}=createHandler();
let queue=Promise.resolve();
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{queue=queue.then(async()=>{
 let m;try{if(Buffer.byteLength(line)>65536)throw Error();m=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');return;}
 try{const result=await handle(m);if(Object.hasOwn(m,'id'))process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');}catch(e){if(Object.hasOwn(m||{},'id'))process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:e.code||-32603,message:e.code?e.message:'Internal error'}})+'\n');}
 }).catch(()=>{});});
input.on('close',()=>{void queue.then(close).catch(()=>{});});
}
