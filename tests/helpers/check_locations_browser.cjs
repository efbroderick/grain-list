// Manual integration QA with local servers 4183/4184 and an installed Playwright.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const output='/private/tmp/grain-list-location-qa';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try {
  const original=JSON.parse(fs.readFileSync('data/organizations.json','utf8'));
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000},deviceScaleFactor:2});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
   await page.route('**/app.js*',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync('dist/app.js','utf8')+'\nwindow.grainTestState=()=>({query:state.query,intent:searchIntent(),filtered:filteredOrganizations(true).map(o=>o.name),last:lastFiltered.length});'}));
   await page.route('**/data/organizations.json*',route=>{
    const payload=JSON.parse(JSON.stringify(original)),o=payload.organizations.find(o=>o.name==='Rye Goods');
    o.slug='rye-goods';
    o.locations=[{id:'loc-1111111111111111',name:'Tustin',address:o.address,city:o.city,state:o.state,phone:o.phone,email:o.email,url:o.url,sources:o.sources,functions:[],grains:[],type:'Bakery',operationalStatus:'Active',location:o.location},{id:'loc-2222222222222222',name:'Costa Mesa',address:'Local QA fixture only',city:'Costa Mesa',state:'CA',phone:'',email:'',url:'',sources:o.sources,functions:[],grains:[],type:'Bakery',operationalStatus:'Active',location:{lat:33.636,lng:-117.918,precision:'place'}},{id:'loc-3333333333333333',name:'Closed location',address:'',city:'',state:'CA',phone:'',email:'',url:'',sources:o.sources,functions:[],grains:[],type:'Bakery',operationalStatus:'Closed',location:null}];
    route.fulfill({json:payload});
   });
   await page.goto('http://127.0.0.1:4184/organizations/rye-goods/?location=loc-1111111111111111');
   await page.locator('#detail-dialog[open]').waitFor({timeout:30000}).catch(async e=>{console.error((await page.locator('body').innerText()).slice(-2000));await page.screenshot({path:output+'/failure.png'});throw e;});
   assert.equal(await page.locator('.profile-location').count(),2);
   assert.deepEqual(await page.locator('.profile-location span').allTextContents(),['Costa MesaCosta Mesa, CA','TustinTustin, CA']);
   assert.match(await page.locator('.profile-location.is-selected').textContent(),/Tustin/);
   await page.locator('[data-profile-location="loc-2222222222222222"]').click();
   assert.match(page.url(),/location=loc-2222222222222222/);
   assert.match(await page.locator('.selected-location-contact').textContent(),/QA fixture/);
   const fonts=await page.locator('.selected-location-contact p').evaluateAll(nodes=>nodes.map(n=>[getComputedStyle(n).fontSize,getComputedStyle(n).fontWeight]));assert.ok(fonts.every(([s,w])=>s==='14px'&&w==='400'));
   assert.ok(!await page.getByText('Functions confirmed at this location').count());
   await page.screenshot({path:`${output}/profile-${width}.png`});
   await page.reload();await page.locator('#detail-dialog[open]').waitFor();assert.match(await page.locator('.profile-location.is-selected').textContent(),/Costa Mesa/);
   await page.locator('#close-detail').click();
   await page.waitForURL(url=>url.pathname==='/');
   await page.waitForTimeout(300);
   await page.locator('#search-input').fill('Rye Goods');await page.locator('#search-input').press('Enter');await page.locator('.result-item').first().waitFor();
   if(await page.locator('#detail-dialog[open]').count())console.log('Unexpected open dialog after query submit',page.url());
   await page.waitForTimeout(600);
   const locations=await page.evaluate(()=>({results:document.querySelectorAll('.result-item').length,overflow:document.documentElement.scrollWidth>innerWidth,input:document.querySelector('#search-input').value,url:location.href,debug:window.grainTestState()}));console.log(locations);assert.equal(locations.overflow,false);assert.equal(locations.results,1);
   await page.screenshot({path:`${output}/map-${width}.png`});
   assert.deepEqual(errors,[]);
   await page.goto('http://127.0.0.1:4183/');await page.getByRole('button',{name:'Sample Farm',exact:true}).waitFor();await page.getByRole('button',{name:'Sample Farm',exact:true}).click();
   await page.locator('#ga-branch-list button').waitFor();
   await page.getByRole('button',{name:'Add location',exact:true}).click();
   await page.locator('[name=branchName]').fill('Boulder');await page.locator('[name=address]').fill('20 Main Street, Boulder, CO 80301');await page.locator('[name=city]').fill('Boulder');await page.locator('[name=branchState]').selectOption('CO');await page.locator('[name=branchSources]').fill('https://sample.test/locations');
   await page.getByText('Coordinates',{exact:true}).click();await page.locator('[name=lat]').fill('40.01');await page.locator('[name=lng]').fill('-105.27');await page.locator('[name=precision]').selectOption('address');await page.locator('[name=locationChecked]').check();
   await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Sample Farm: Draft saved',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Research organization',exact:true}).click();await page.locator('#ga-research-url').fill('https://sample.com/');await page.getByRole('button',{name:'Research website',exact:true}).click();await page.locator('.ga-research-finding').first().waitFor();
   assert.match(await page.locator('#ga-research-results').textContent(),/Rye/);assert.doesNotMatch(await page.locator('#ga-research-results').textContent(),/grains: Hard Red Winter Wheat/);
   await page.locator('#ga-research-close').click();
   await page.screenshot({path:`${output}/admin-${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'Review changes',exact:true}).click();await page.getByRole('button',{name:'Save to Sheet & publish',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Save to Sheet & publish',exact:true}).isEnabled(),true);
   assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Desktop/mobile map, branch URLs, closed branches, typography, admin save and research passed. Screenshots: '+output);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
