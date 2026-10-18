import { useState } from 'react';
import type { PublicRoomState } from '@acg-codenames/shared';
import { Dialog } from './UI';
import { NextMatchPanel } from './AnimePlay';

export function RoomSettingsDialog({room,close}:{room:PublicRoomState;close:()=>void}) {
  const [edit,setEdit]=useState({dirty:false,busy:false});
  const [discard,setDiscard]=useState(false);
  const requestClose=()=>{if(edit.busy)return;if(edit.dirty)setDiscard(true);else close();};
  return <><Dialog title="本局设置" wide className="room-settings-dialog" closeDisabled={edit.busy} close={requestClose}>
    <p className="hint-text">修改只保存在当前草稿中，保存后同步到房间；队伍和席位保持原有管理方式。</p>
    <NextMatchPanel room={room} mode="settings" onConfigured={close} onCancel={requestClose} onEditStateChange={setEdit}/>
  </Dialog>{discard&&<Dialog title="放弃本次修改？" close={()=>setDiscard(false)}>
    <p>未保存的草稿会被丢弃，房间继续使用服务器已确认的设置。</p>
    <div className="anime-toolbar"><button onClick={()=>setDiscard(false)}>继续编辑</button><button className="primary-button" onClick={close}>放弃修改</button></div>
  </Dialog>}</>;
}
