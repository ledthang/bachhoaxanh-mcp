const fail=()=>{throw Error('BHX_PRODUCT_UNVERIFIED');};
export function projectProduct(payload,productId){
 const d=payload?.data;
 if(!Number.isSafeInteger(productId)||productId<1||d?.id!==productId||!Array.isArray(d.boxBuys))fail();
 const boxes=d.boxBuys.filter(b=>b?.id===productId);
 if(boxes.length!==1)fail();
 const b=boxes[0];
 if(!Array.isArray(b.productPrices)||!b.productPrices.length)fail();
 const prices=b.productPrices.map(p=>{
  if(p===null||typeof p!=='object')fail();
  if(!Number.isSafeInteger(p.price)||p.price<0||!Number.isSafeInteger(p.sysPrice)||p.sysPrice<0||p.price>p.sysPrice)fail();
  return {price_vnd:p.price,list_price_vnd:p.sysPrice,can_buy:typeof p.isCanBuy==='boolean'?p.isCanBuy:null};
 });
 return {product_id:productId,variant:b.type??null,scenario:b.scenario??null,prices,availability:prices.every(p=>p.can_buy===false)?'unavailable':'unknown',stock_quantity:null,maximum_quantity:null,price_status:'observed-detail-not-guaranteed-payable'};
}
export function quantityAvailability(product,quantity){
 if(product===null||typeof product!=='object'||!Number.isSafeInteger(product.product_id)||product.product_id<1)fail();
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>1000)throw Error('INVALID_QUANTITY');
 return {product_id:product.product_id,requested_quantity:quantity,status:product.availability==='unavailable'?'unavailable':'unknown',stock_quantity:null,reason:product.availability==='unavailable'?'site-disallows-purchase':'quantity-specific-stock-not-verified'};
}
