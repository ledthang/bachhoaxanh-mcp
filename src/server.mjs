import { createInterface } from 'node:readline';
import { readSnapshot } from './browser.mjs';
const names=['bhx_auth_status','bhx_list_addresses','bhx_get_delivery_context','bhx_get_cart','bhx_cart_summary','bhx_search_products'];
const tools=names.map(name=>({name,description:'Read authenticated BHX state. No checkout or payment. Catalog price is not guaranteed payable price.',inputSchema:{type:'object',properties:name==='bhx_search_products'?{query:{type:'string',minLength:1,maxLength:100}}:{},required:name==='bhx_search_products'?['query']:[],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false}}));
let initialized=false;
async function handle(m){
 if(!m||m.jsonrpc!=='2.0'||typeof m.method!=='string')throw {code:-32600,message:'Invalid Request'};
 if(m.method==='initialize'){initialized=true;return {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'bhx-mcp',version:'0.1.0'}};}
 if(m.method==='notifications/initialized')return;
 if(m.method==='ping')return {};
 if(!initialized)throw {code:-32000,message:'Initialize first'};
 if(m.method==='tools/list')return {tools};
 if(m.method!=='tools/call')throw {code:-32601,message:'Method not found'};
 const {name,arguments:args={}}=m.params||{};
 if(!names.includes(name)||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>name!=='bhx_search_products'||k!=='query')||(name==='bhx_search_products'&&(typeof args.query!=='string'||args.query.length<1||args.query.length>100||/[\p{Cc}\p{Cf}]/u.test(args.query))))throw {code:-32602,message:'Invalid tool arguments'};
 try{
  const s=await readSnapshot(args.query,name==='bhx_search_products');
  const data=name==='bhx_auth_status'?{authenticated:s.authenticated,session_status:s.session_status,requires_login:s.requires_login}:name==='bhx_list_addresses'?{addresses:s.addresses}:name==='bhx_get_delivery_context'?s.context:name==='bhx_search_products'?{products:s.products,context:s.context,limit:3,price_status:'catalog-observed-not-guaranteed-payable'}:{...s.cart,context:s.context};
  return {content:[{type:'text',text:JSON.stringify({...data,observed_at:s.observed_at})}]};
 }catch{return {isError:true,content:[{type:'text',text:'BHX_READ_UNVERIFIED: session, selected address or response could not be verified. No cart mutation performed.'}]};}
}
let queue=Promise.resolve();
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{queue=queue.then(async()=>{
 let m;try{if(Buffer.byteLength(line)>65536)throw Error();m=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');return;}
 try{const result=await handle(m);if(Object.hasOwn(m,'id'))process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');}catch(e){if(Object.hasOwn(m||{},'id'))process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:e.code||-32603,message:e.code?e.message:'Internal error'}})+'\n');}
 }).catch(()=>{});});
