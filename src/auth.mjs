import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function createLogin({ display=process.env.DISPLAY, launch=spawn }={}) {
  let current;
  const close=async()=>{
    const state=current;if(!state)return;
    state.child?.kill('SIGTERM');
    await Promise.race([state.exited,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('LOGIN_CLOSE_UNVERIFIED')),5000);t.unref();})]);
    if(current===state)current=null;
  };
  return {close,active:()=>Boolean(current),async start(){
    if(current)return current.ready;
    if(!display)throw Error('LOGIN_DISPLAY_REQUIRED: configure a private graphical desktop. Never expose VNC or browser debugging publicly.');
    let exited;
    const state={exited:new Promise(r=>{exited=r;})};current=state;
    state.ready=new Promise((resolve,reject)=>{
      let settled=false,buffer='';
      const timer=setTimeout(()=>{fail();state.child?.kill('SIGTERM');},65000);timer.unref();
      const fail=()=>{clearTimeout(timer);if(!settled){settled=true;reject(Error('LOGIN_START_FAILED'));}};
      try{
        state.child=launch(process.execPath,[fileURLToPath(new URL('../scripts/login.mjs',import.meta.url))],{env:{...process.env,DISPLAY:display},stdio:['ignore','pipe','pipe']});
        state.child.on('error',()=>{fail();if(!state.child.pid){exited();if(current===state)current=null;}});
        state.child.once('exit',()=>{fail();exited();if(current===state)current=null;});
        state.child.stderr.on('data',()=>{});
        state.child.stdout.on('data',data=>{
          if(settled)return;
          buffer+=data.toString();if(buffer.length>4096){fail();state.child.kill('SIGTERM');return;}
          if(buffer.split('\n').some(line=>{try{return JSON.parse(line).event==='login_browser_ready';}catch{return false;}})){
            settled=true;clearTimeout(timer);
            resolve({status:'interactive-login-ready',authenticated:false,instructions:'Use configured private desktop browser. Enter credentials, OTP or CAPTCHA directly on BHX, never in chat. Close browser, then call bhx_auth_status.'});
          }
        });
      }catch{fail();exited();if(current===state)current=null;}
    });
    return state.ready;
  }};
}
