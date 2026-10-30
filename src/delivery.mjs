import { readSnapshot } from './browser.mjs';
import { chromium } from 'playwright';
import { allowedRequest } from '../scripts/cart-poc.mjs';
import { profileDirectory } from './profile.mjs';

async function applySelection(before,id) {
  const api='https://api.bachhoaxanh.com',prefix=api+'/gw/cart/api/OrderV2/';
  let profile,cart,delivery,armed=false,sent=false;
  const browser=await chromium.launchPersistentContext(profileDirectory(),{headless:process.env.BHX_HEADED!=='1',serviceWorkers:'block',executablePath:process.env.BHX_CHROMIUM_PATH||undefined});
  try {
    const page=await browser.newPage();for(const old of browser.pages())if(old!==page)await old.close();
    page.on('response',async response=>{try{
      if(response.url().endsWith('/profile/full-profile'))profile=await response.json();
      if(response.url()===prefix+'get'){cart=(await response.json()).Value;delivery=response.request().postDataJSON();}
    }catch{}});
    await browser.route('**/*',async route=>{try{
      const q=route.request(),u=new URL(q.url());
      if(q.url()===prefix+'SelectProfile'){
        const address=profile?.data?.addressReceiver?.find(a=>String(a.addressId)===id);
        if(!armed||sent||!selectionAllowed(q.url(),q.method(),q.postDataJSON(),{...delivery,cartId:cart?.CartId,address}))return route.abort();
        sent=true;return route.continue();
      }
      const ok=allowedRequest(q.url(),q.method(),q.isNavigationRequest(),q.resourceType(),'/gio-hang')||(u.origin===api&&q.method()==='GET'&&['/gw/LocationV3/GetFull','/gw/cart/api/OrderV2/GetRecommandStores'].includes(u.pathname));
      return ok?route.continue():route.abort();
    }catch{await route.abort();}});
    await page.goto('https://www.bachhoaxanh.com/gio-hang',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>Boolean(document.querySelector('#btn_choose_location')));
    for(let i=0;i<100&&(!profile||!cart||!delivery);i++)await page.waitForTimeout(100);
    // ponytail: only observed single-address contract; enable cross-address changes after live reconciliation evidence.
    if(profile?.data?.addressReceiver?.length!==1||String(profile.data.addressReceiver[0].addressId)!==id||cart?.TotalItemShow!==0||!cart?.CartId)throw Error('BHX_ADDRESS_SELECTION_CONTRACT_UNVERIFIED');
    if(!['provinceId','wardId','storeId'].every((key,i)=>String(delivery[key])===String(before.context[['province_id','ward_id','store_id'][i]])))throw Error('BHX_DELIVERY_CONTEXT_CHANGED');
    await page.locator('#btn_choose_location').click();
    const choices=page.locator('.lstProfile > div');if(await choices.count()!==1)throw Error('BHX_ADDRESS_SELECTION_CONTRACT_UNVERIFIED');
    await choices.click();armed=true;
    const ack=page.waitForResponse(r=>r.url()===prefix+'SelectProfile'&&r.request().method()==='POST',{timeout:15000});
    await page.locator('button:visible').filter({hasText:/^XÁC NHẬN$/i}).click();
    const response=await ack,body=await response.json();
    if(!sent||!response.ok()||body.HttpCode!==200||body.ResultCode!==0)throw Error('BHX_ADDRESS_SELECTION_UNVERIFIED');
    await page.waitForTimeout(1000);
  } finally {await browser.close();}
}

export function validateAddressInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).length !== 1 || !Object.hasOwn(input, 'address_id') ||
      typeof input.address_id !== 'string' || !/^[1-9]\d{0,15}$/.test(input.address_id) ||
      !Number.isSafeInteger(Number(input.address_id))) throw Error('INVALID_ADDRESS_ID');
  return input.address_id;
}

export function selectionAllowed(url,method,body,baseline) {
  const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
  if(url!=='https://api.bachhoaxanh.com/gw/cart/api/OrderV2/SelectProfile'||method!=='POST'||!baseline?.address)return false;
  if(!exact(body,['data','districtId','provinceId','storeId','wardId','isNewModel'])||body.isNewModel!==true||body.districtId!==Number(baseline.address.districtId)||!['provinceId','storeId','wardId'].every(k=>body[k]===baseline[k]))return false;
  const d=body.data,a=baseline.address;
  return Boolean(exact(d,['CartId','Lat','Lng','ProfileDetailId','ProfileDetailIds','wardId'])&&d.CartId===baseline.cartId&&d.ProfileDetailId===Number(a.addressId)&&d.Lat===Number(a.lat)&&d.Lng===Number(a.lng)&&Number.isFinite(d.Lat)&&Number.isFinite(d.Lng)&&d.wardId===Number(a.wardId)&&Array.isArray(d.ProfileDetailIds)&&d.ProfileDetailIds.length===0);
}

const fail = code => { throw Error(code); };
function selected(snapshot, id) {
  if (snapshot?.authenticated !== true || snapshot.requires_login !== false)
    fail('BHX_AUTH_REQUIRED');
  if (!Array.isArray(snapshot.addresses) ||
      snapshot.addresses.filter(address => address.id === id).length !== 1)
    fail('BHX_ADDRESS_NOT_SAVED');
  const context = snapshot.context;
  if (context?.verified !== true || !['address_id', 'province_id', 'ward_id', 'store_id'].every(key =>
    /^[1-9]\d*$/.test(String(context[key])) && Number.isSafeInteger(Number(context[key]))))
    fail('BHX_DELIVERY_CONTEXT_UNVERIFIED');
  if (snapshot.addresses.filter(address => address.selected === true).length !== 1 ||
      !snapshot.addresses.some(address => address.selected === true && address.id === context.address_id))
    fail('BHX_DELIVERY_CONTEXT_UNVERIFIED');
  return context;
}

export async function selectAddress(input, snapshotReader = readSnapshot, apply = applySelection) {
  const id = validateAddressInput(input);
  let before, after;
  try { before = await snapshotReader(); }
  catch { fail('BHX_AUTH_CONTEXT_REQUIRED'); }
  const context = selected(before, id);
  if (context.address_id !== id) fail('BHX_ADDRESS_SELECTION_CONTRACT_UNVERIFIED');
  if (!Array.isArray(before.cart?.items) || before.cart.items.length) fail('BHX_ADDRESS_NONEMPTY_CART');
  await apply(before,id);
  try { after = await snapshotReader(); }
  catch { fail('BHX_ADDRESS_RESTART_UNVERIFIED'); }
  if (!Array.isArray(after.cart?.items) || after.cart.items.length) fail('BHX_ADDRESS_CART_CHANGED');
  const fresh = selected(after, id);
  if (['address_id', 'province_id', 'ward_id', 'store_id'].some(key => fresh[key] !== context[key]))
    fail('BHX_DELIVERY_CONTEXT_CHANGED');
  return {
    selected: true, changed: false, restart_verified: true,
    selection_status: 'selected-and-restarted',

    context: { address_id: '[masked]', province_id: '[masked]', ward_id: '[masked]',
      store_id: '[masked]', verified: true, source: 'authenticated-browser-restart' },
    observed_at: after.observed_at,
  };
}

export const deliveryErrors = Object.freeze(['BHX_AUTH_REQUIRED', 'BHX_ADDRESS_NOT_SAVED',
  'BHX_DELIVERY_CONTEXT_UNVERIFIED', 'BHX_AUTH_CONTEXT_REQUIRED',
  'BHX_ADDRESS_SELECTION_CONTRACT_UNVERIFIED', 'BHX_ADDRESS_NONEMPTY_CART', 'BHX_ADDRESS_CART_CHANGED', 'BHX_ADDRESS_SELECTION_UNVERIFIED', 'BHX_ADDRESS_RESTART_UNVERIFIED', 'BHX_DELIVERY_CONTEXT_CHANGED']);
