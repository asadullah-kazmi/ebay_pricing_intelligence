"use client";
import { FormEvent, useState } from "react";

type Result = { oem:string; marketplace:string; searchedAt:string; analytics:null|{count:number;lowest:number;average:number;median:number;highest:number;recommendedPrice:number;currency:string}; listings:Array<{id:string;title:string;seller:string;price:number;shipping:number;landedPrice:number;currency:string;condition:string;url:string}> };
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function Home() {
  const [oem,setOem]=useState("8K0615301M"), [marketplace,setMarketplace]=useState("EBAY_US");
  const [result,setResult]=useState<Result|null>(null), [error,setError]=useState(""), [loading,setLoading]=useState(false);
  async function search(event:FormEvent){event.preventDefault();setLoading(true);setError("");try{const response=await fetch(`${api}/api/search`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({oem,marketplace})});const data=await response.json();if(!response.ok)throw new Error(data.error??"Search failed");setResult(data)}catch(err){setError(err instanceof Error?err.message:"Search failed")}finally{setLoading(false)}}
  const money=(value:number,currency:string)=>new Intl.NumberFormat("en",{style:"currency",currency}).format(value);
  return <main>
    <header><div><span className="eyebrow">AUTOMOTIVE INTELLIGENCE</span><h1>Part<span>Pulse</span></h1></div><div className="status"><i/> MARKET DATA ONLINE</div></header>
    <section className="hero"><div><p className="kicker">COMPETITOR PRICE SEARCH</p><h2>Know the market.<br/><em>Price with confidence.</em></h2><p>Validate exact automotive part matches and turn active eBay listings into a clear pricing decision.</p></div>
      <form onSubmit={search}><label>OEM / MPN / INTERCHANGE NUMBER</label><div className="search"><input value={oem} onChange={e=>setOem(e.target.value)} placeholder="e.g. 8K0615301M"/><select value={marketplace} onChange={e=>setMarketplace(e.target.value)}><option value="EBAY_US">eBay US</option><option value="EBAY_GB">eBay UK</option><option value="EBAY_DE">eBay DE</option></select><button disabled={loading}>{loading?"Searching…":"Analyze market →"}</button></div><small>Exact item-specific verification · Own sellers excluded · Shipping included</small></form>
    </section>
    {error&&<p className="error">{error}. Make sure the API is running on port 4000.</p>}
    {result&&<section className="results"><div className="resultTitle"><div><span className="eyebrow">VERIFIED MARKET SNAPSHOT</span><h3>{result.oem}</h3></div><span>{result.marketplace.replace("EBAY_","")} · {new Date(result.searchedAt).toLocaleString()}</span></div>
      {result.analytics?<><div className="metrics">{[["LOWEST LANDED",result.analytics.lowest],["MARKET AVERAGE",result.analytics.average],["MEDIAN",result.analytics.median],["RECOMMENDED",result.analytics.recommendedPrice]].map(([label,value])=><article key={String(label)}><small>{label}</small><strong>{money(Number(value),result.analytics!.currency)}</strong></article>)}</div>
      <div className="tableWrap"><table><thead><tr><th>LISTING</th><th>SELLER</th><th>CONDITION</th><th>ITEM</th><th>SHIPPING</th><th>LANDED PRICE</th></tr></thead><tbody>{result.listings.map(item=><tr key={item.id}><td><a href={item.url} target="_blank">{item.title}</a></td><td>{item.seller}</td><td><span className="pill">{item.condition}</span></td><td>{money(item.price,item.currency)}</td><td>{money(item.shipping,item.currency)}</td><td><b>{money(item.landedPrice,item.currency)}</b></td></tr>)}</tbody></table></div></>:<div className="empty">No exact verified competitor matches found.</div>}
    </section>}
    <footer>PARTPULSE / EBAY AUTOMOTIVE PRICE INTELLIGENCE <span>Exact matches. Better margins.</span></footer>
  </main>;
}
