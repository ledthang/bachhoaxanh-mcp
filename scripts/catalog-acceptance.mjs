import { readSnapshot } from '../src/browser.mjs';
import { catalogContract } from '../src/product.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const rows=[];
await mkdir('data',{recursive:true,mode:0o700});
const save=()=>writeFile('data/catalog-acceptance.json',JSON.stringify(rows,null,2),{mode:0o600});
let failed=false;
for(const query of ['ức gà','thịt heo','cá hồi','cải ngọt','sữa tươi']){
 try{
  const snapshot=await readSnapshot(query,true,null,async(page,{products})=>{
   for(const result of products.slice(0,query==='sữa tươi'?5:2)){
    const card=page.locator('.box_product').filter({has:page.locator(`a[href="${result.path}"]`)}).first();
    await card.waitFor({state:'visible',timeout:10000});
    const text=(await card.innerText()).replace(/\s+/g,' ').trim();
    const prices=(text.match(/\d[\d.,]*\s*(?:₫|đ)/gi)||[]).map(value=>Number(value.replace(/\D/g,'')));
    rows.push({query,...catalogContract(result),prices:result.prices,website_card:text,name_match:text.includes(result.name),price_token_match:prices.includes(result.display_price??Math.round(result.prices[0].price)),observed_at:new Date().toISOString(),context_verified:true});
   }
  });
  console.log(JSON.stringify({query,count:snapshot.products.length,compared:rows.filter(row=>row.query===query).length}));
 }catch{failed=true;console.log(JSON.stringify({query,error:'READ_OR_COMPARISON_UNVERIFIED'}));}
 await save();
}
const count=new Set(rows.map(row=>row.product_id)).size;
console.log(JSON.stringify({distinct_products:count,acceptance:'partial-until-price-promotion-and-availability-verified'}));
if(failed||count<10)process.exitCode=1;
