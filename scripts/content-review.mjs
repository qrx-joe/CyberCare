import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

const normal=value=>value.normalize('NFC').replace(/\s+/gu,'');
const digest=value=>createHash('sha256').update(value).digest('hex');
const id=z.string().min(1).max(100);
const unitSchema=z.discriminatedUnion('state',[
 z.object({id,state:z.literal('legible'),text:z.string().trim().min(1).max(2000),region:z.string().min(1).max(300)}).strict(),
 z.object({id,state:z.literal('unscored'),reason:z.string().min(1).max(700),region:z.string().min(1).max(300)}).strict(),
]);
const judgements=['supported-by-image','not-stated-in-image','uncertain-source','interpretation'];
const selectionSchema=z.object({
 units:z.array(unitSchema).min(1).max(100),
 claims:z.array(z.object({id,section:z.enum(['original','summary','description']),quote:z.string().trim().min(1).max(1500),judgement:z.enum(judgements),
  evidenceUnitIds:z.array(id).max(20),region:z.string().min(1).max(300),basis:z.string().min(1).max(1500)}).strict()).max(100),
}).strict();
const observedSchema=z.object({original:z.string().min(1).max(12000),summary:z.string().max(1500),description:z.string().max(1500)});
const fileSchema=z.object({path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const manifestSchema=selectionSchema.extend({
 schemaVersion:z.literal('content-review-v1'),id,
 reviewer:z.object({kind:z.literal('development-agent'),blind:z.literal(false),independentHuman:z.literal(false)}).strict(),
 source:z.object({page:z.url(),author:z.string().min(1),license:z.string().min(1)}).strict(),
 image:fileSchema,prior:fileSchema,capture:fileSchema,upstreamReport:fileSchema,
 priorTranscriptKey:z.enum(['independentTranscript','referenceTranscription']),
}).strict();

/** Selected literal coverage and explicit reviewer annotations; no semantic scoring. */
export function reviewContent(selection,priorTranscript,observed){
 const data=selectionSchema.parse(selection),output=observedSchema.parse(observed);
 if(typeof priorTranscript!=='string'||!priorTranscript.trim())throw new Error('A frozen prior transcript is required.');
 const ids=new Set();for(const unit of data.units){if(ids.has(unit.id))throw new Error('Duplicate unit id.');ids.add(unit.id);}
 const source=normal(priorTranscript),actual=normal(output.original);
 const units=data.units.map(unit=>{
  if(unit.state==='unscored')return{...unit,outcome:'unscored'};
  const expected=normal(unit.text);
  if(!source.includes(expected))throw new Error(`Reference unit absent from frozen prior: ${unit.id}`);
  return{...unit,outcome:actual.includes(expected)?'literal-present':actual.toLowerCase().includes(expected.toLowerCase())?'case-variant':'not-located'};
 });
 const claimIds=new Set();for(const claim of data.claims){
  if(claimIds.has(claim.id))throw new Error('Duplicate claim id.');claimIds.add(claim.id);
  if(!output[claim.section].includes(claim.quote))throw new Error(`Review quote absent from captured output: ${claim.id}`);
  if(claim.evidenceUnitIds.some(unit=>!ids.has(unit)))throw new Error(`Unknown evidence unit: ${claim.id}`);
 }
 const unitCounts=Object.fromEntries(['literal-present','case-variant','not-located','unscored'].map(outcome=>[outcome,units.filter(unit=>unit.outcome===outcome).length]));
 const annotationCounts=Object.fromEntries(judgements.map(judgement=>[judgement,data.claims.filter(claim=>claim.judgement===judgement).length]));
 return{
  scope:'Selected prior text units and development-agent post-hoc annotations; not blind or independent human evaluation.',
  automatic:{units,counts:unitCounts,selectedLegibleUnits:units.filter(unit=>unit.state==='legible').length,
   limits:'NFC and whitespace-normalized substring presence only; no order, multiplicity, extra-text, image-truth or semantic verification.'},
  reviewerAnnotations:{claims:data.claims,counts:annotationCounts,exhaustive:false,limits:'Quoted observations are supplied by the development reviewer; locating a quote does not validate its judgement.'},
  selectedOpenFindings:unitCounts['not-located']>0||annotationCounts['not-stated-in-image']>0||annotationCounts['uncertain-source']>0,
  overallQuality:'not-assessed',newModelRequests:0,
 };
}

function inside(root,path){
 const part=relative(root,path);
 if(part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw new Error('Path outside the workspace.');
 return path;
}
export async function runContentReview(manifestPath,outputPath,workspaceRoot=process.cwd()){
 const root=resolve(workspaceRoot),manifestFile=inside(root,resolve(root,manifestPath));
 const target=inside(resolve(root,'.local/validation'),resolve(root,outputPath));
 const read=async(path,limit=4*1024*1024)=>{if((await stat(path)).size>limit)throw new Error('Review input exceeds the local size limit.');return readFile(path);};
 const manifestBytes=await read(manifestFile,256*1024),manifest=manifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
 const inputs={};
 for(const key of ['image','prior','capture','upstreamReport']){
  const ref=manifest[key],path=inside(root,resolve(dirname(manifestFile),ref.path)),bytes=await read(path);
  if(digest(bytes)!==ref.sha256)throw new Error(`Input hash mismatch: ${key}`);
  inputs[key]={bytes,sha256:ref.sha256,path:relative(root,path)};
 }
 const prior=JSON.parse(inputs.prior.bytes.toString('utf8'));
 const review=reviewContent({units:manifest.units,claims:manifest.claims},prior[manifest.priorTranscriptKey],JSON.parse(inputs.capture.bytes.toString('utf8')));
 const report={schemaVersion:'content-review-report-v1',id:manifest.id,createdAt:new Date().toISOString(),source:manifest.source,reviewer:manifest.reviewer,
  manifestSha256:digest(manifestBytes),toolSha256:digest(await readFile(fileURLToPath(import.meta.url))),
  inputs:Object.fromEntries(Object.entries(inputs).map(([key,value])=>[key,{path:value.path,sha256:value.sha256}])),...review};
 await mkdir(dirname(target),{recursive:true});await writeFile(target,JSON.stringify(report,null,2),{flag:'wx'});return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--manifest'||args[2]!=='--output')throw new Error('Use --manifest <local JSON> --output <new .local/validation JSON>.');
  const result=await runContentReview(args[1],args[3]);
  console.log(JSON.stringify({id:result.id,automatic:result.automatic.counts,annotations:result.reviewerAnnotations.counts,selectedOpenFindings:result.selectedOpenFindings,overallQuality:result.overallQuality,newModelRequests:0,report:args[3]}));
 }catch(error){console.error(error instanceof z.ZodError?'Invalid review manifest or captured content.':error instanceof SyntaxError?'Invalid JSON review input.':error instanceof Error?error.message:'Review failed.');process.exitCode=2;}
}
