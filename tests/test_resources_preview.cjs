const test=require('node:test');
const assert=require('node:assert/strict');
const {resourcesPage}=require('../tools/build_resources_preview.cjs');
const config=require('../config/resources.json');
test('resources draft has accessible sections and safe, attributed source links',()=>{
  const html=resourcesPage(config),urls=new Set();for(const s of config.sections){assert.ok(html.includes(`id="${s.id}"`));for(const r of s.resources){assert.equal(new URL(r.url).protocol,'https:');assert.ok(r.publisher);assert.ok(html.includes(r.url));urls.add(r.url);}}
  assert.equal(urls.size,8);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/name="robots" content="noindex"/);assert.doesNotMatch(html,/iframe|<form/);
});
test('resources titles and descriptions are escaped rather than treated as markup',()=>{const html=resourcesPage({reviewed:'today',sections:[{id:'test',title:'<script>',icon:'book-open',resources:[{title:'<img>',url:'https://example.test/',publisher:'A & B',description:'<script>alert(1)</script>'}]}]});assert.match(html,/&lt;script&gt;/);assert.match(html,/A &amp; B/);assert.doesNotMatch(html,/<img>/);});
