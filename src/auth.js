export const API_ORIGIN = 'https://jimrong79-slate-lab-api.jimrong79.chatgpt.site';
export const CONTACT_EMAIL = 'jimrong79@gmail.com';
const SESSION_KEY='slatelab-auth-v1', VERIFIER_KEY='slatelab-auth-verifier-v1';
let session=null;
const stored = key => {try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}};
export class AccessError extends Error {constructor(message,status,code){super(message);this.status=status;this.code=code;}}
export const currentSession = () => session && session.expiresAt>Date.now() ? session : null;
function forget(){session=null;try{sessionStorage.removeItem(SESSION_KEY);}catch{}}
async function request(path,{method='GET',data,signal,token=currentSession()?.token}={}) {
  const response=await fetch(`${API_ORIGIN}${path}`,{method,cache:'no-store',credentials:'omit',signal:signal||AbortSignal.timeout(15000),
    headers:{...(token?{authorization:`Bearer ${token}`} : {}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  let result;try{result=await response.json();}catch{throw new AccessError('Sign-in service is unavailable. Please try again.',503,'service_unavailable');}
  if(!response.ok){if(response.status===401||response.status===403)forget();throw new AccessError(result.error||'Request failed.',response.status,result.code);}
  return result;
}
export async function initializeAuth(){
  const fragment=new URLSearchParams(location.hash.slice(1));
  const code=fragment.get('slatelab-auth'),error=fragment.get('slatelab-auth-error');
  if(code||error)history.replaceState(null,'',location.pathname+location.search);
  if(error){forget();sessionStorage.removeItem(VERIFIER_KEY);throw new AccessError(error==='access_denied'?`For access, contact ${CONTACT_EMAIL}.`:'GitHub sign-in was cancelled. Please try again.',403,error);}
  if(code){
    const proof=stored(VERIFIER_KEY);sessionStorage.removeItem(VERIFIER_KEY);
    if(!proof||proof.expiresAt<Date.now())throw new AccessError('This sign-in attempt expired. Please sign in again.',401,'sign_in_required');
    const result=await request('/api/session',{method:'POST',data:{code,verifier:proof.verifier},token:null});
    session={token:result.token,login:result.login,expiresAt:result.expiresAt};sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
  }else session=stored(SESSION_KEY);
  if(!currentSession()){forget();return null;}
  let verified;try{verified=await request('/api/session');}catch(error){forget();throw error;}
  if(!verified.allowed||verified.login!=='jimrong79'){forget();throw new AccessError(`For access, contact ${CONTACT_EMAIL}.`,403,'access_denied');}
  session={...session,...verified};return session;
}
export async function signIn(platform='yahoo'){
  const health=await request('/api/health',{token:null});
  if(!health.authConfigured)throw new AccessError('GitHub sign-in setup is not complete yet.',503,'auth_not_configured');
  const verifier=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  const challenge=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  sessionStorage.setItem(VERIFIER_KEY,JSON.stringify({verifier,expiresAt:Date.now()+600000}));
  const url=new URL(`${API_ORIGIN}/api/auth/github`);url.searchParams.set('challenge',challenge);url.searchParams.set('platform',platform);
  location.assign(url);
}
export async function signOut(){const token=session?.token;try{if(token)await request('/api/session',{method:'DELETE',token});}finally{forget();}}
export async function generateAuthenticated(data,signal){
  if(!currentSession())throw new AccessError('Sign in with GitHub to generate a lineup.',401,'sign_in_required');
  return (await request('/api/generate',{method:'POST',data,signal})).result;
}
