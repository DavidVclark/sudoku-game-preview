/* NANPURE audio: one streaming music element, one context, bounded action/reward SFX voices. */
(() => {
 'use strict';
 const cfg=window.NANPURE_AUDIO_CONFIG,base=new URL('assets/assets/audio/approved/',document.baseURI);
 let prefs={effects:false,effectsVolume:.72,music:false,musicVolume:.16,foreground:true},configured=false,unlocked=false,dead=false,ctx,music,musicSource,musicGain,musicPending=false,appliedMusicVolume;
 const buffers=new Map(),compressed=new Map();let decoder;const voices={action:null,reward:null},pending={action:null,reward:null},tickets={action:0,reward:0};
 const stats={contexts:0,offlineDecoders:0,effectsCreated:0,effectsReleased:0,activeEffects:0,musicElements:0,musicStarts:0,bufferBytes:0,droppedCold:0,maxEffects:0,cues:[]};
 const eligible=()=>!dead&&prefs.foreground&&!document.hidden;
 const url=asset=>new URL(asset,base).href;
 const files=[...new Set(Object.values(cfg.configuration).filter(x=>!x.silent).map(x=>x.asset))];
 // A single offline decoder prepares short cues without a running audio graph.
 // The audible context/music player still wait for a user gesture.
 for(const asset of files)compressed.set(asset,fetch(url(asset)).then(r=>{if(!r.ok)throw Error('Missing audio');return r.arrayBuffer();}).catch(()=>null));
 const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
 function prepare(owner){return Promise.allSettled([...compressed].map(([asset,promise])=>promise.then(async data=>{if(!data||dead)return;try{const b=await owner.decodeAudioData(data);if(!dead){buffers.set(asset,b);stats.bufferBytes=[...buffers.values()].reduce((n,x)=>n+x.length*x.numberOfChannels*4,0);}}catch{}finally{compressed.delete(asset);}})));}
 if(Offline){decoder=new Offline(1,1,44100);stats.offlineDecoders++;prepare(decoder).finally(()=>decoder=null);}
 function quiet(){if(ctx&&ctx.state==='running'&&(!music||music.paused)&&!Object.values(voices).some(Boolean)&&!Object.values(pending).some(Boolean))ctx.suspend().catch(()=>{});}
 function cancelSlot(slot){tickets[slot]++;pending[slot]=null;const v=voices[slot];if(v){voices[slot]=null;v.source.onended=null;try{v.source.stop();}catch{}v.source.disconnect();v.gain.disconnect();stats.effectsReleased++;}stats.activeEffects=Object.values(voices).filter(Boolean).length;}
 function cancelEffects(suspend=true){cancelSlot('action');cancelSlot('reward');if(suspend)quiet();}

 function create(){if(ctx)return;ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'interactive'});stats.contexts++;
  if(!Offline)prepare(ctx);
 }
 function startMusic(){if(!ctx||!unlocked||!eligible()||!prefs.music||prefs.musicVolume===0){if(music)music.pause();quiet();return;}
  if(!music){music=new Audio(url(cfg.music.asset));music.preload='none';music.loop=true;musicSource=ctx.createMediaElementSource(music);musicGain=ctx.createGain();musicSource.connect(musicGain).connect(ctx.destination);stats.musicElements++;
   music.addEventListener('playing',()=>{stats.musicStarts++;if(!eligible()||!prefs.music){music.pause();quiet();}});
  }
  if(appliedMusicVolume===undefined)musicGain.gain.setValueAtTime(prefs.musicVolume,ctx.currentTime);
  else if(appliedMusicVolume!==prefs.musicVolume){musicGain.gain.cancelScheduledValues(ctx.currentTime);musicGain.gain.setTargetAtTime(prefs.musicVolume,ctx.currentTime,.025);}
  appliedMusicVolume=prefs.musicVolume;
  if(music.paused&&!musicPending){musicPending=true;music.play().catch(()=>{}).finally(()=>{musicPending=false;if(!eligible()||!prefs.music){music.pause();quiet();}});}
 }
 function unlock(){if(!configured||!eligible())return;unlocked=true;create();ctx.resume().catch(()=>{});startMusic();}
 function configure(effects,effectsVolume,bgm,musicVolume,foreground){const oldVolume=prefs.effectsVolume;configured=true;prefs={effects,effectsVolume,music:bgm,musicVolume,foreground};
  if(ctx&&oldVolume!==effectsVolume)for(const v of Object.values(voices)){if(!v)continue;const now=ctx.currentTime,fade=Math.min(.003,Math.max(0,(v.end-now)/3));v.gain.gain.cancelScheduledValues(now);v.gain.gain.setTargetAtTime(effectsVolume,now,.01);v.gain.gain.setValueAtTime(effectsVolume,Math.max(now,v.end-fade));v.gain.gain.linearRampToValueAtTime(0,v.end);}
  if(!eligible()||!effects||effectsVolume===0)cancelEffects();
  if(!eligible()||!bgm||musicVolume===0){if(music)music.pause();quiet();}else if(unlocked){if(ctx?.state!=='running')ctx.resume().catch(()=>{});startMusic();}
 }
 function play(action){
  const c=cfg.configuration[action];if(!c||c.silent||!prefs.effects||prefs.effectsVolume===0||!eligible())return;
  const reward=['row','column','box','multi'].includes(action),slot=reward?'reward':'action';
  // A power's activation and its immediate section reward are distinct, bounded cues.
  // All other new interactions/terminal/UI cues replace prior effects; nothing queues.
  const activation=(voices.action||pending.action)?.action;
  if(reward&&['arrow','bomb','reveal'].includes(activation))cancelSlot('reward');else cancelEffects(false);
  const ticket=tickets[slot],requestedMs=performance.now(),b=buffers.get(c.asset);
  if(!b||!ctx||!unlocked){stats.droppedCold++;quiet();return;}
  pending[slot]={ticket,action};
  function begin(){
   if(ticket!==tickets[slot]){quiet();return;}pending[slot]=null;
   if(!eligible()||!prefs.effects||prefs.effectsVolume===0||performance.now()-requestedMs>150){quiet();return;}
   if(ctx.state!=='running'){quiet();return;}
   const source=ctx.createBufferSource(),gain=ctx.createGain(),start=ctx.currentTime+.008;
   const offset=c.playback.start/1000,length=Math.min((c.playback.end-c.playback.start)/1000,b.duration-offset),fade=Math.min(.003,length/3);
   if(length<=0)return;source.buffer=b;source.connect(gain).connect(ctx.destination);
   gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(prefs.effectsVolume,start+fade);gain.gain.setValueAtTime(prefs.effectsVolume,start+length-fade);gain.gain.linearRampToValueAtTime(0,start+length);
   voices[slot]={source,gain,end:start+length,action};stats.effectsCreated++;stats.activeEffects=Object.values(voices).filter(Boolean).length;stats.maxEffects=Math.max(stats.maxEffects,stats.activeEffects);
   const record={action,asset:c.asset,channel:slot,requestedMs,startedMs:performance.now(),scheduledContext:start,volume:prefs.effectsVolume,offsetMs:c.playback.start,durationMs:length*1000};stats.cues.push(record);if(stats.cues.length>200)stats.cues.shift();
   source.onended=()=>{if(voices[slot]?.source===source){voices[slot]=null;source.disconnect();gain.disconnect();stats.effectsReleased++;stats.activeEffects=Object.values(voices).filter(Boolean).length;quiet();}};
   source.start(start,offset,length);
  }
  if(ctx.state==='running')begin();else ctx.resume().then(begin).catch(()=>{if(ticket===tickets[slot])pending[slot]=null;quiet();});
 }

 function background(){cancelEffects();if(music)music.pause();quiet();}
 document.addEventListener('pointerdown',unlock,{capture:true,passive:true});document.addEventListener('keydown',unlock,{capture:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)background();else if(unlocked&&eligible()){ctx?.resume().catch(()=>{});startMusic();}});
 window.addEventListener('pagehide',background);
 window.nanpureAudio={configure,unlock,play,cancelEffects,dispose(){dead=true;background();musicSource?.disconnect();musicGain?.disconnect();if(music){music.removeAttribute('src');music.load();}buffers.clear();compressed.clear();ctx?.close().catch(()=>{});},
  snapshot:()=>({...stats,contextState:ctx?.state||'not-created',musicTime:music?.currentTime||0,musicDuration:music?.duration||0,musicPaused:!music||music.paused,musicEnabled:prefs.music,effectsEnabled:prefs.effects,musicVolume:prefs.musicVolume,effectsVolume:prefs.effectsVolume,ready:buffers.size===files.length}),
  // Inspection helpers for isolated release verification; never modify game state.
  seekMusic:seconds=>{if(music&&Number.isFinite(seconds))music.currentTime=Math.max(0,Math.min(seconds,music.duration));}
 };
})();
