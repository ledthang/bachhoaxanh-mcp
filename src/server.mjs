import { createInterface } from 'node:readline';
import { createLogin } from './auth.mjs';
import { selectAddress, validateAddressInput, deliveryErrors } from './delivery.mjs';
import { readSnapshot } from './browser.mjs';
import { quantityAvailability, validateLookup, catalogContract } from './product.mjs';
import { pathToFileURL } from 'node:url';
import { createCartSession, validateMutation } from './cart-mutations.mjs';
const mutationNames = ['bhx_add_to_cart', 'bhx_update_cart_item', 'bhx_remove_cart_item'];
const names=['bhx_auth_status','bhx_list_addresses','bhx_get_delivery_context','bhx_get_cart','bhx_cart_summary','bhx_search_products'];
const tools=names.map(name=>({name,description:'Read authenticated BHX state. No checkout or payment. Catalog price is not guaranteed payable price.',inputSchema:{type:'object',properties:name==='bhx_search_products'?{query:{type:'string',minLength:1,maxLength:100}}:{},required:name==='bhx_search_products'?['query']:[],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}));
for (const name of mutationNames) tools.push({name,description:'Explicitly authorized exact-target cart mutation. Add requires recent authenticated search in this process, fresh product/variant/context and price ceiling. Positive safe integer quantities; update/remove only runtime-owned lines. Existing product IDs cannot be added. Unrelated lines must remain unchanged. No checkout/payment. Stop on uncertainty; no blind retries.',inputSchema:{type:'object',properties:{user_authorized:{type:'boolean',const:true},...(name==='bhx_add_to_cart'?{product_id:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},quantity:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},max_unit_price_vnd:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}}:{line_id:{type:'string',minLength:1,maxLength:200},...(name==='bhx_update_cart_item'?{quantity:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER}}:{})})},required:name==='bhx_add_to_cart'?['user_authorized','product_id','quantity','max_unit_price_vnd']:name==='bhx_update_cart_item'?['user_authorized','line_id','quantity']:['user_authorized','line_id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}});
for(const name of ['bhx_get_product','bhx_check_availability'])tools.push({name,description:'Resolve product_id from authenticated query results before detail read. Quantity stock unknown unless explicitly proven.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1,maxLength:100},...(name==='bhx_get_product'?{product_id:{type:'integer',minimum:1}}:{items:{type:'array',minItems:1,maxItems:1,items:{type:'object',properties:{product_id:{type:'integer',minimum:1},quantity:{type:'integer',minimum:1,maximum:1000}},required:['product_id','quantity'],additionalProperties:false}}})},required:['query',name==='bhx_get_product'?'product_id':'items'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}});
tools.push({name:'bhx_login_start',description:'Open interactive BHX login on configured private desktop. Human handles OTP/CAPTCHA. Close login browser before other operations.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false}});
tools.push({name:'bhx_select_address',description:'Select an existing saved delivery address and verify fresh context. Requires empty cart while nonempty-cart address changes remain unverified.',inputSchema:{type:'object',properties:{address_id:{type:'string',pattern:'^[1-9][0-9]{0,15}$'}},required:['address_id'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}});
export function createHandler({sessionFactory=createCartSession, snapshotReader=readSnapshot,loginFactory=createLogin,addressSelector=selectAddress}={}) {
let initialized=false, session, baselineRead;
const observations = new Map();
const login=loginFactory();
async function handle(m){
 if(!m||m.jsonrpc!=='2.0'||typeof m.method!=='string')throw {code:-32600,message:'Invalid Request'};
 if(m.method==='initialize'){initialized=true;return {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'bhx-mcp',version:'0.1.0'}};}
 if(m.method==='notifications/initialized')return;
 if(m.method==='ping')return {};
 if(!initialized)throw {code:-32000,message:'Initialize first'};
 if(m.method==='tools/list')return {tools};
 if(m.method!=='tools/call')throw {code:-32601,message:'Method not found'};
 const {name,arguments:args={}}=m.params||{};
 if(['bhx_login_start','bhx_select_address'].includes(name)){
  if(!Object.hasOwn(m,'id')||!(typeof m.id==='string'||Number.isSafeInteger(m.id)))throw {code:-32600,message:'Operation requires request id'};
  try{if(name==='bhx_select_address')validateAddressInput(args);else if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)throw Error();}catch{throw {code:-32602,message:'Invalid operation arguments'};}
  if(session||name==='bhx_select_address'&&login.active())return {isError:true,content:[{type:'text',text:'BROWSER_BUSY: close current browser session before changing authentication or address.'}]};
  try{const data=name==='bhx_login_start'?await login.start():await addressSelector(args);return {content:[{type:'text',text:JSON.stringify(data)}]};}catch(error){const code=name==='bhx_select_address'&&deliveryErrors.includes(error.message)?error.message:name==='bhx_login_start'&&error.message.startsWith('LOGIN_DISPLAY_REQUIRED')?'LOGIN_DISPLAY_REQUIRED: configure a private graphical desktop.':'OPERATION_UNVERIFIED: inspect selected address or private login browser before retrying.';return {isError:true,content:[{type:'text',text:code}]};}
 }
 if(login.active())return {isError:true,content:[{type:'text',text:'LOGIN_IN_PROGRESS: close login browser, then verify authentication.'}]};
 if(mutationNames.includes(name)) {
  if(!Object.hasOwn(m,'id')||!(typeof m.id==='string'||Number.isSafeInteger(m.id)))throw {code:-32600,message:'Mutation requires request id'};
  try { validateMutation(name,args); } catch(error) { throw {code:-32602,message:error.message}; }
  try { session ??= await sessionFactory({observations, expectedBaseline:baselineRead}); const data=await session.mutate(name,args); return {content:[{type:'text',text:JSON.stringify(data)}]}; }
  catch { return {isError:true,content:[{type:'text',text:'BHX_MUTATION_UNVERIFIED: cleanup_required; mutation may have applied. Stop and inspect cart. No automatic retry or cleanup. Exact runtime ownership and preservation required.'}]}; }
 }
 if(['bhx_get_product','bhx_check_availability'].includes(name)){
  const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const exact=(v,ks)=>plain(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
  const item=name==='bhx_get_product'?args:args?.items?.[0];
  if((name==='bhx_get_product'? !exact(args,['query','product_id']): !exact(args,['query','items'])||!Array.isArray(args.items)||args.items.length!==1||!exact(item,['product_id','quantity'])||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>1000)||!Number.isSafeInteger(item?.product_id)||item.product_id<1)throw {code:-32602,message:'Invalid product arguments: query and positive product_id required'};
  try{validateLookup(args.query,item.product_id);}catch{throw {code:-32602,message:'Invalid query or product_id'};}
  try{
   if(session)throw Error('Mutation browser active');
   const s=await snapshotReader(args.query,false,item.product_id);
   const data=name==='bhx_get_product'?s.product:{items:[quantityAvailability(s.product,item.quantity)]};
   return {content:[{type:'text',text:JSON.stringify({...data,context:s.context,observed_at:s.observed_at})}]};
  }catch{return {isError:true,content:[{type:'text',text:'BHX_PRODUCT_UNVERIFIED: supply query returning product_id; verify login and selected delivery context. Stock remains unknown without proof.'}]};}
 }
 if(!names.includes(name)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>name!=='bhx_search_products'||k!=='query')||(name==='bhx_search_products'&&(typeof args.query!=='string'||args.query.length<1||args.query.length>100||/[\p{Cc}\p{Cf}]/u.test(args.query))))throw {code:-32602,message:'Invalid tool arguments'};
 try{
  if(session && ['bhx_get_cart','bhx_cart_summary'].includes(name)){const data=await session.readCart();return {content:[{type:'text',text:JSON.stringify(data)}]};}
  if(session) throw Error('Dedicated mutation context active; separate read browser cannot acquire profile');
  const s=await snapshotReader(name==='bhx_search_products'?args.query:'cải ngọt',name==='bhx_search_products');
  if(name==='bhx_search_products')for(const product of s.products)observations.set(product.id,{query:args.query,at:Date.now(),context:s.context});
  if(name==='bhx_get_cart'||name==='bhx_cart_summary')baselineRead={cart:s.cart,context:s.context};
  const data=name==='bhx_auth_status'?{authenticated:s.authenticated,session_status:s.session_status,requires_login:s.requires_login}:name==='bhx_list_addresses'?{addresses:s.addresses}:name==='bhx_get_delivery_context'?s.context:name==='bhx_search_products'?{products:s.products.map(catalogContract),context:s.context,pagination:'unverified-first-response-only',price_status:'catalog-observed-not-guaranteed-payable'}:{...s.cart,context:s.context};
  return {content:[{type:'text',text:JSON.stringify({...data,observed_at:s.observed_at})}]};
 }catch{return {isError:true,content:[{type:'text',text:'BHX_READ_UNVERIFIED: session, selected address or response could not be verified. No cart mutation performed.'}]};}
}
return {handle,close:async()=>{await login.close();await session?.close();}};
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
