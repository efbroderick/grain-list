// Local integration harness only. This never uses real Google/GitHub credentials.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {fixture}=require('./admin_fixture.cjs');
const f=fixture(), root=path.join(__dirname,'../../admin/apps-script');
const sheet=f.tables.get('Listings'),second=[...sheet.rows[1]];
for(const [column,value] of Object.entries({Name:'Second Farm','Record ID':'org-second','Public ID':'grain-abcdefabcdefabcd'}))second[f.headers.indexOf(column)]=value;
sheet.rows.push(second);
const delay=Number(process.env.ADMIN_TEST_DELAY_MS||0);let failNext=process.env.ADMIN_TEST_FAIL_ONCE==='1';
const transport=`<script>
function localRunner(success,failure){return new Proxy({}, {get(_,name){if(name==='withSuccessHandler')return fn=>localRunner(fn,failure);if(name==='withFailureHandler')return fn=>localRunner(success,fn);return (...args)=>fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:name,args})}).then(r=>r.json()).then(r=>r.error?failure(new Error(r.error)):success(r.result));}});}
window.google={script:{run:localRunner(()=>{},()=>{})}};
</script>`;
http.createServer((req,res)=>{
  if(req.method==='GET'&&req.url==='/'){
    let html=fs.readFileSync(path.join(root,'Index.html'),'utf8');
    for(const file of ['Styles','Client'])html=html.replace(`<?!= HtmlService.createHtmlOutputFromFile('${file}').getContent(); ?>`,(file==='Client'?transport:'')+fs.readFileSync(path.join(root,file+'.html'),'utf8'));
    html=html.replace('<body>','<body><p style="margin:0;padding:10px 24px;background:#fff3dc;color:#765214;font:14px sans-serif">Local integration test. No real Sheet or website is changed.</p>');
    res.setHeader('Content-Type','text/html');res.end(html);return;
  }
  if(req.method==='POST'&&req.url==='/rpc'){
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>100000)req.destroy();});req.on('end',async()=>{
      res.setHeader('Content-Type','application/json');try{const input=JSON.parse(body);if(!['getAdminState','initializeAdmin','saveAdminDraft','publishAdminDraft','getAdminPublicationStatus','lookupAdminAddress'].includes(input.method))throw new Error('Unsupported test method');
        if(delay&&input.method!=='getAdminState')await new Promise(resolve=>setTimeout(resolve,delay));
        if(failNext&&input.method==='saveAdminDraft'){failNext=false;throw new Error('Simulated temporary connection failure');}
        const result=f.context[input.method](...input.args);
        if(input.method==='publishAdminDraft'&&result.status==='Queued'){f.env.runs=[{display_title:'Admin publication '+result.requestId,status:'completed',conclusion:'success',html_url:'https://github.com/efbroderick/grain-list/actions'}];const payload=JSON.parse(f.env.dispatches.at(-1).inputs.publication);for(const o of payload.upserts){const i=f.env.live.findIndex(r=>r.id===o.id);if(i>=0)f.env.live[i]=o;else f.env.live.push(o);}f.env.live=f.env.live.filter(o=>!payload.removals.includes(o.id));}
        res.end(JSON.stringify({result}));}catch(error){res.end(JSON.stringify({error:error.message}));}
    });return;
  }
  res.writeHead(404);res.end();
}).listen(4183,'127.0.0.1',()=>console.log('Admin test preview: http://127.0.0.1:4183/'));
