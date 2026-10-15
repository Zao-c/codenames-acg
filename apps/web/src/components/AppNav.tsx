import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useGame } from '../context/GameContext';
import { Dialog, Icon } from './UI';

function useTheme() {
 const [light,setLight]=useState(()=>localStorage.getItem('theme')==='light');
 useEffect(()=>{document.documentElement.classList.toggle('light',light);localStorage.setItem('theme',light?'light':'dark');},[light]);
 return [light,useCallback(()=>setLight(v=>!v),[])] as const;
}
export function AppNav() {
 const g=useGame();const navigate=useNavigate();const location=useLocation();const [light,toggleTheme]=useTheme();const [settings,setSettings]=useState(false);const [rules,setRules]=useState(false);
 const inRoom=!!g.room&&location.pathname.startsWith('/room/');
 const leave=()=>{if(window.confirm('确定要离开房间吗？')){g.leaveRoom();navigate('/');setSettings(false);}};
 const links=[{path:'/',label:'大厅'},{path:'/create',label:'创建房间'},{path:'/packs',label:'文字题库'},{path:'/gallery',label:'动画图库'},{path:g.effectiveIdentity?'/profile':'/login',label:g.effectiveIdentity?'个人资料':'登录'}];
 return <>
  <nav className={`app-nav ${inRoom?'app-nav-room':''}`} aria-label="主导航">
   <button className="nav-brand" onClick={()=>inRoom?leave():navigate('/')}><span className="brand-mark"><Icon name="cards" size={22}/></span><span>词牌结社<small>一词相连，同好成局</small></span></button>
   <div className="nav-links">{inRoom?<><span className="nav-room-label">{g.room?.settings.variant==='anime'?'动画组牌':g.room?.gameMode==='reveal-guess'?'揭幕猜番':'经典词牌'}</span><button onClick={()=>void g.copyLink()}>{g.copied?'已复制链接':'复制邀请链接'}</button><button onClick={g.focusMode?g.exitFocusMode:g.enterFocusMode}>{g.focusMode?'退出专注':'专注模式'}</button><button onClick={()=>setRules(true)}>规则说明</button></>:links.map(l=><button key={l.path} className={location.pathname===l.path?'selected':''} onClick={()=>navigate(l.path)}>{l.label}</button>)}</div>
   <div className="nav-tools"><button className="icon-button theme-button" onClick={toggleTheme} aria-label={light?'切换暗色主题':'切换亮色主题'} title={light?'切换暗色主题':'切换亮色主题'}><Icon name={light?'moon':'sun'}/></button><button className="icon-button" onClick={()=>setSettings(true)} aria-label="打开快捷设置"><Icon name="settings"/></button><span className="nav-identity">{g.effectiveIdentity?.nickname??'欢迎加入'}</span></div>
  </nav>
  {settings&&<Dialog title="快捷设置" close={()=>setSettings(false)}><div className="quick-settings"><button onClick={toggleTheme}><Icon name={light?'moon':'sun'}/>{light?'切换暗色主题':'切换亮色主题'}</button><button onClick={()=>g.setSoundEnabled(!g.soundEnabled)}><Icon name={g.soundEnabled?'sound':'mute'}/>{g.soundEnabled?'关闭音效':'开启音效'}</button>{inRoom?<><button onClick={()=>{g.focusMode?g.exitFocusMode():g.enterFocusMode();setSettings(false);}}>{g.focusMode?'退出专注':'专注模式'}</button><button onClick={()=>void g.copyLink()}>{g.copied?'已复制链接':'复制邀请链接'}</button><button onClick={()=>{setSettings(false);setRules(true);}}>规则说明</button><button className="danger-button" onClick={leave}>离开房间</button></>:links.map(l=><button key={l.path} onClick={()=>{navigate(l.path);setSettings(false);}}>{l.label}</button>)}</div></Dialog>}
  {rules&&<Dialog title="规则说明" close={()=>setRules(false)}><div className="rules-copy"><h3>用一个词，连接同伴的想象。</h3><p>两队队长能看到棋盘阵营。轮到你时给出一个线索和数字，让队员找出属于自己队伍的牌。猜到刺客会立即失败。</p><h3>动画组牌</h3><p>双方队长确认后有 180 秒组牌。点空闲牌领取，点己方牌撤回；长按或拖动对方牌抢夺，长按空闲牌放置干扰。新领取的牌有 10 秒保护，最后 20 秒不能抢夺或更改干扰。双方完成或时间结束后随机补齐并封存。</p><p>私人书签仅本人可见。正式猜牌时，点击封面只打开预览，需要再次明确确认猜牌。房主负责发起五秒开局。</p><p>经典词牌保留 5×5、7×7 和 9×9；动画组牌支持 5×5 和 6×6。揭幕猜番是独立玩法，规则与操作在其房间中显示。</p></div></Dialog>}
 </>;
}
export function MobileNav() {
 const g=useGame();const navigate=useNavigate();const location=useLocation();const inRoom=!!g.room&&location.pathname.startsWith('/room/');
 const roomTabs=[{id:'board' as const,label:g.room?.phase==='lobby'?'准备':'棋盘',icon:'cards' as const},{id:'players' as const,label:'玩家',icon:'users' as const},{id:'chat' as const,label:'聊天',icon:'chat' as const}];
 const links=[{path:'/',label:'大厅',icon:'home' as const},{path:'/packs',label:'题库',icon:'book' as const},{path:'/gallery',label:'图库',icon:'cards' as const},{path:g.effectiveIdentity?'/profile':'/login',label:'我的',icon:'users' as const}];
 return <nav className="mobile-nav" aria-label={inRoom?'房间导航':'手机导航'}>{inRoom?roomTabs.map(t=><button key={t.id} className={`mobile-nav-tab ${g.mobileRoomTab===t.id?'selected':''}`} aria-pressed={g.mobileRoomTab===t.id} onClick={()=>{g.setMobileRoomTab(t.id);g.exitFocusMode();if(t.id==='chat')g.setSideTab('chat');}}><Icon name={t.icon}/><span>{t.label}</span></button>):links.map(l=><button key={l.path} className={`mobile-nav-tab ${location.pathname===l.path?'selected':''}`} onClick={()=>navigate(l.path)}><Icon name={l.icon}/><span>{l.label}</span></button>)}</nav>;
}
