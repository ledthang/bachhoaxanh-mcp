const fail=()=>{throw Error('BHX_PRODUCT_UNVERIFIED');};
export function validateLookup(query,productId){
 if(typeof query!=='string'||!query.trim()||query.length>100||/[\p{Cc}\p{Cf}]/u.test(query))throw Error('INVALID_QUERY');
 if(productId!==null&&(!Number.isSafeInteger(productId)||productId<1))throw Error('INVALID_PRODUCT_ID');
}
export function detailRequestAllowed(value,method,result,context){
 try{
  const url=new URL(value), params=url.searchParams;
  if(!result||!/^\/[a-z0-9-]+\/[a-z0-9-]+$/.test(result.path)||method!=='GET'||url.origin!=='https://api.bachhoaxanh.com'||url.pathname!=='/gw/Product/GetProductDetail'||url.username||url.password||url.hash)return false;
  const [category,slug]=result.path.slice(1).split('/');
  if(!(params.get('productId')===String(result.id)||(params.get('CategoryUrl')===category&&params.get('ProductUrl')===slug)))return false;
  return [...params].every(([key,value])=>params.getAll(key).length===1&&(key==='productId'?value===String(result.id):key==='CategoryUrl'?value===category:key==='ProductUrl'?value===slug:['provinceId','wardId','storeId','districtId'].includes(key)&&/^(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)===context?.[key]))&&['provinceId','wardId','storeId'].every(key=>params.get(key)===String(context?.[key]));
 }catch{return false;}
}
export function catalogContract(result){
 const contract=ordinaryCatalogContract(result);
 if(result.display_price!=null){
  contract.display_price=result.display_price;
  contract.promotion=result.promotion;
  contract.price_status=result.price_status;
 }
 return contract;
}
function ordinaryCatalogContract(result){
 const label=result.name;
 const variable=/(?:\d\s*(?:kg|gr|g|ml|lít|l)?\s*[-–~]\s*\d|khoảng|ngẫu nhiên)/iu.test(label);
 const ambiguous=/\d[.,]\d{3}(?:\D|$)/u.test(label);
 const match=variable||ambiguous?null:label.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*(kg|gr|g|ml|lít|l)(?=\s|$)/i);
 const multipack=label.match(/(?:lốc|thùng|hộp)\s+(\d+)\s+(hộp|chai|lon|gói|túi|bịch)(?=\s|$)/iu);
 return {product_id:result.id,name:label,path:result.path,package_size:{raw_label:label,unit_label:result.unit,kind:variable?'variable':multipack?'multipack':match?'fixed':'unknown',normalized:match?{amount:Number(match[1].replace(',','.')),unit:match[2].toLowerCase()==='gr'?'g':match[2].toLowerCase()==='lít'?'l':match[2].toLowerCase()}:null,pack_count:multipack?Number(multipack[1]):null,source:'search-label-not-measured-weight'},prices:result.prices.map(price=>({price_vnd:price.price,list_price_vnd:price.list_price,can_buy:price.can_buy})),currency:'VND',variant:null,scenario:null,price_status:'catalog-observed-not-guaranteed-payable',promotion:{status:'unknown',raw_label:null,observed_price_reduction:result.prices.some(price=>price.price<price.list_price)},availability:result.prices.every(price=>price.can_buy===false)?'unavailable':'unknown',stock_quantity:null,maximum_quantity:null};
}
export function projectProduct(payload,productId){
 const d=payload?.data;
 if(!Number.isSafeInteger(productId)||productId<1||d?.id!==productId||!Array.isArray(d.boxBuys))fail();
 const boxes=d.boxBuys.filter(b=>b?.id===productId);
 if(boxes.length!==1)fail();
 const b=boxes[0];
 if(['type','scenario'].some(key=>b[key]!=null&&(!Number.isSafeInteger(b[key])||b[key]<0)))fail();
 if(!Array.isArray(b.productPrices)||!b.productPrices.length)fail();
 const prices=b.productPrices.map(p=>{
  if(p===null||typeof p!=='object')fail();
  if(typeof p.price!=='number'||!Number.isFinite(p.price)||p.price<0||typeof p.sysPrice!=='number'||!Number.isFinite(p.sysPrice)||p.sysPrice<0)fail();
  // VND has no sub-unit. Upstream occasionally emits float noise (e.g. 23799.999999999985); snap to whole VND, then re-check ordering.
  const price=Math.round(p.price), list=Math.round(p.sysPrice);
  if(price>list)fail();
  return {price_vnd:price,list_price_vnd:list,can_buy:typeof p.isCanBuy==='boolean'?p.isCanBuy:null};
 });
 return {product_id:productId,variant:b.type??null,scenario:b.scenario??null,prices,availability:prices.every(p=>p.can_buy===false)?'unavailable':'unknown',stock_quantity:null,maximum_quantity:null,price_status:'observed-detail-not-guaranteed-payable'};
}
export function quantityAvailability(product,quantity){
 if(product===null||typeof product!=='object'||!Number.isSafeInteger(product.product_id)||product.product_id<1)fail();
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)throw Error('INVALID_QUANTITY');
 return {product_id:product.product_id,requested_quantity:quantity,status:product.availability==='unavailable'?'unavailable':'unknown',stock_quantity:null,reason:product.availability==='unavailable'?'site-disallows-purchase':'quantity-specific-stock-not-verified'};
}
