import { chromium } from 'playwright';
import { projectProduct } from './product.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { allowedRequest } from '../scripts/cart-poc.mjs';
import { matchContext, projectProducts } from '../scripts/catalog-poc.mjs';
const SITE='https://www.bachhoaxanh.com', API='https://api.bachhoaxanh.com';
const PROFILE=API+'/gw/bhx-api-identity/api/v1/profile/full-profile', CART=API+'/gw/cart/api/OrderV2/get', SEARCH=API+'/gw/search/v2/DataSearch';
const fail=()=>{throw Error('BHX_READ_UNVERIFIED');};
export function projectCartRead(payload) {
  if(payload?.HttpCode!==200||payload?.ResultCode!==0)fail();
  const c=payload.Value;
  if(!c||!Object.hasOwn(c,'GroupSOStep2InCart')||!Number.isSafeInteger(c.TotalItemShow)||c.TotalItemShow<0||!Number.isSafeInteger(c.CartTotal?.Total)||c.CartTotal.Total<0)fail();
  if(c.GroupSOStep2InCart!==null&&!Array.isArray(c.GroupSOStep2InCart))fail();
  const groups=[...(c.GroupSOStep2InCart||[]).map(g=>[g,false]),...(c.GroupCartOff==null?[]:[[c.GroupCartOff,true]])];
  const items=[];
  for(const [g,inactive] of groups){
    if(!Array.isArray(g?.ListCartItemBuy))fail();
    for(const l of g.ListCartItemBuy){
      if(!Number.isSafeInteger(l.Id)||l.Id<=0||typeof l.GuildId!=='string'||!Number.isSafeInteger(l.QuantityInCart)||l.QuantityInCart<1||!Number.isSafeInteger(l.Price)||l.Price<0||!Number.isSafeInteger(l.Total)||l.Total<0||typeof l.Name!=='string')fail();
      items.push({product_id:l.Id,line_id:l.GuildId,name:l.Name,quantity:l.QuantityInCart,unit_price:l.Price,total:l.Total,inactive});
    }
  }
  return {items,total:c.CartTotal.Total,currency:'VND',price_source:'authenticated-cart-read',availability:items.length?'observed-cart-state':'unknown'};
}
export async function readSnapshot(query='cải ngọt', requireProducts=false, productId=null) {
  if(typeof query!=='string'||query.length<1||query.length>100||/[\p{Cc}\p{Cf}]/u.test(query))throw Error('INVALID_QUERY');
  if(productId!==null&&productId!==335195)throw Error('PRODUCT_ROUTE_UNVERIFIED');
  const url=productId===null?SITE+'/tim-kiem?key='+encodeURIComponent(query):SITE+'/rau-sach/cai-ngot-tui-400gr';
  let browser,profile,cart,delivery,searchContext,products,fatal,product,detailContext;
  const pending=new Set();
  const timer=setTimeout(()=>{fatal=true;void browser?.close().catch(()=>{});},55000);
  try{
    browser=await chromium.launchPersistentContext(process.env.BHX_PROFILE_DIR||join(process.env.BHX_RUNTIME_DIR||join(homedir(),'.local/share/bhx-mcp'),'profile'),{headless:process.env.BHX_HEADED!=='1',serviceWorkers:'block',offline:true,timeout:30000,...(process.env.BHX_CHROMIUM_PATH?{executablePath:process.env.BHX_CHROMIUM_PATH}:{})});
    const page=await browser.newPage();for(const old of browser.pages())if(old!==page)await old.close();
    await browser.route('**/*',async route=>{
      const q=route.request();let allow=false;
      try{
        const u=new URL(q.url());
        if(process.env.BHX_DIAGNOSTICS==='1'&&u.origin===API&&/search/i.test(u.pathname))console.error(JSON.stringify({search_path:u.pathname,method:q.method(),keys:(()=>{try{return Object.keys(q.postDataJSON()||{});}catch{return [];}})()}));
        if(u.origin===API&&/search/i.test(u.pathname)&&q.method()==='POST'&&process.env.BHX_DIAGNOSTICS==='1')console.error(JSON.stringify({query_match:q.postDataJSON()?.keywords===query}));
        allow=q.frame()===page.mainFrame()&&(
          (q.isNavigationRequest()&&[url,SITE+'/gio-hang',SITE+'/tim-kiem?key='+encodeURIComponent(query)].includes(q.url())&&q.method()==='GET')||
          (!q.isNavigationRequest()&&allowedRequest(q.url(),q.method(),false,q.resourceType()))||
          (!q.isNavigationRequest()&&q.url().toLowerCase()===SEARCH.toLowerCase()&&q.method()==='POST')||
          (!q.isNavigationRequest()&&q.url()===API+'/gw/search/GetSuggestSearchNew'&&q.method()==='POST'&&q.postDataJSON()?.keyword===query)||
          (!q.isNavigationRequest()&&q.url()===API+'/gw/LocationV3/GetFull'&&q.method()==='GET'));
        if(u.username||u.password||u.hash)allow=false;
      }catch{}
      if(allow)await route.continue();else await route.abort();
    });
    page.on('response',r=>{
      const detail=new URL(r.url()).pathname==='/gw/Product/GetProductDetail'&&new URL(r.url()).origin===API;
      if(!detail&&![PROFILE,CART].includes(r.url())&&r.url().toLowerCase()!==SEARCH.toLowerCase())return;
      const task=(async()=>{
        if(!r.ok()||r.request().frame()!==page.mainFrame())fail();
        const b=await Promise.race([r.json(),new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('READ_TIMEOUT')),10000);t.unref();})]);
        if(detail){if(productId===null)return;const u=new URL(r.url());detailContext=Object.fromEntries(['provinceId','wardId','storeId'].map(k=>[k,Number(u.searchParams.get(k))]));product=projectProduct(b,productId);return;}
        if(r.url()===PROFILE){profile=b;return;}
        const raw=r.request().postDataJSON();
        if(r.url()===CART){
          if(b?.HttpCode!==200||b?.ResultCode!==0)fail();
          cart=b;delivery=Object.fromEntries(['provinceId','districtId','wardId','storeId'].map(k=>[k,raw?.[k]]));
        }else{
          if(raw?.keywords!==query)return;
          searchContext=Object.fromEntries(['provinceId','wardId','storeId'].map(k=>[k,raw?.[k]]));
          products=projectProducts(b);
        }
      })().catch(()=>{fatal=true;});pending.add(task);void task.finally(()=>pending.delete(task));
    });
    await browser.setOffline(false);
    // Cart POST only fires after the site enters /gio-hang; visit it first, then the target page.
    const cartDeadline=Date.now()+30000;
    while(!fatal&&!cart&&Date.now()<cartDeadline){await page.goto(SITE+'/gio-hang',{waitUntil:'domcontentloaded',timeout:30000});while(!fatal&&!cart&&Date.now()<cartDeadline)await page.waitForTimeout(300);}
    if(fatal||!cart)fail();
    if(productId===null){await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});}
    else{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});}
    const deadline=Date.now()+20000;
    while(!fatal&&(!profile||!cart||(requireProducts&&!products)||(productId!==null&&!product))&&Date.now()<deadline)await page.waitForTimeout(100);
    while(pending.size)await Promise.allSettled([...pending]);
    if(process.env.BHX_DIAGNOSTICS==='1')console.error(JSON.stringify({fatal:!!fatal,profile:!!profile,cart:!!cart,products:!!products,url_match:page.url()===url}));
    if(fatal||page.url()!==url||!profile||!cart||(requireProducts&&!products)||(productId!==null&&!product))fail();
    if(productId!==null){const heading=page.locator('div.sticky h1');await heading.waitFor({state:'visible',timeout:10000});if(await heading.count()!==1)fail();const name=(await heading.innerText()).trim();if(!name||name.length>300||/[\p{Cc}\p{Cf}]/u.test(name))fail();product={...product,name,package_size:{raw_label:name,normalized:null,source:'product-heading'},promotion:{status:'unknown'}};}
    if(fatal)fail();
    const match=matchContext(profile,cart.Value,delivery,searchContext);
    if(productId!==null&&['provinceId','wardId','storeId'].some(k=>!Number.isSafeInteger(detailContext?.[k])||detailContext[k]!==delivery[k]))fail();
    if(!match.profile_cart_match||(requireProducts&&!match.search_cart_match))fail();
    const context={address_id:String(cart.Value.ShipAddressId),store_id:delivery.storeId,province_id:delivery.provinceId,ward_id:delivery.wardId,verified:true,source:'authenticated-browser'};
    context.delivery_context_id=createHash('sha256').update(JSON.stringify(context)).digest('hex').slice(0,24);
    return {authenticated:true,session_status:'valid',requires_login:false,addresses:profile.data.addressReceiver.map((a,i)=>({id:String(a.addressId),label:`Address ${i+1}`,selected:String(a.addressId)===context.address_id})),context,cart:projectCartRead(cart),products,product,observed_at:new Date().toISOString()};
  }finally{clearTimeout(timer);await browser?.close();}
}
