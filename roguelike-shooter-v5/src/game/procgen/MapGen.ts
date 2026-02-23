import { makeRng } from "../rng";

export type MapTile = 0 | 1;
export type MapData = { seed:number; w:number; h:number; tileSize:number; tiles:MapTile[]; start:{x:number;y:number}; exit:{x:number;y:number} };
type Rect = { x:number; y:number; w:number; h:number };

function idx(x:number,y:number,w:number){ return y*w+x; }
function clamp(v:number,lo:number,hi:number){ return Math.max(lo,Math.min(hi,v)); }
function carveRect(tiles:MapTile[],mapW:number,rect:Rect,value:MapTile){
  for(let y=rect.y;y<rect.y+rect.h;y++) for(let x=rect.x;x<rect.x+rect.w;x++) tiles[idx(x,y,mapW)]=value;
}
function carveCorridor(tiles:MapTile[],w:number,x1:number,y1:number,x2:number,y2:number){
  const dx=Math.sign(x2-x1), dy=Math.sign(y2-y1);
  let x=x1,y=y1; tiles[y*w+x]=0;
  while(x!==x2||y!==y2){
    if(x!==x2) x+=dx;
    if(y!==y2) y+=dy;
    tiles[y*w+x]=0;
    if(dx!==0){
      if(y-1>=0) tiles[(y-1)*w+x]=0;
      if(y+1<9999) tiles[(y+1)*w+x]=0;
    } else {
      if(x-1>=0) tiles[y*w+(x-1)]=0;
      if(x+1<9999) tiles[y*w+(x+1)]=0;
    }
  }
}

export function generateMap(floor:number, baseSeed:number, viewW:number, viewH:number): MapData {
  const tileSize = 32;
  const tilesWide = Math.ceil(viewW / tileSize);
  const tilesHigh = Math.ceil(viewH / tileSize);
  const w = clamp(tilesWide + 26, 52, 92);
  const h = clamp(tilesHigh + 18, 34, 64);

  const seed = (baseSeed ^ (floor * 0x9e3779b9)) >>> 0;
  const rng = makeRng(seed);
  const tiles: MapTile[] = new Array(w*h).fill(1);

  const BORDER=1;
  const leaves:Rect[]=[{x:BORDER,y:BORDER,w:w-BORDER*2,h:h-BORDER*2}];
  const rooms:Rect[]=[];

  const MIN_LEAF = clamp(Math.floor(Math.min(w,h)*0.18),10,16);
  const MAX_LEAF = clamp(Math.floor(Math.min(w,h)*0.30),18,26);

  for(let i=0;i<140;i++){
    const candidates=leaves.filter(r=>r.w>MAX_LEAF||r.h>MAX_LEAF);
    if(candidates.length===0) break;
    const leaf=candidates[Math.floor(rng()*candidates.length)];
    leaves.splice(leaves.indexOf(leaf),1);
    const splitH = leaf.w<leaf.h ? true : leaf.h<leaf.w ? false : rng()<0.5;
    if(splitH){
      const split=Math.floor(clamp(leaf.h*(0.35+rng()*0.30),MIN_LEAF,leaf.h-MIN_LEAF));
      leaves.push({x:leaf.x,y:leaf.y,w:leaf.w,h:split});
      leaves.push({x:leaf.x,y:leaf.y+split,w:leaf.w,h:leaf.h-split});
    } else {
      const split=Math.floor(clamp(leaf.w*(0.35+rng()*0.30),MIN_LEAF,leaf.w-MIN_LEAF));
      leaves.push({x:leaf.x,y:leaf.y,w:split,h:leaf.h});
      leaves.push({x:leaf.x+split,y:leaf.y,w:leaf.w-split,h:leaf.h});
    }
  }

  for(const leaf of leaves){
    if(leaf.w<MIN_LEAF||leaf.h<MIN_LEAF) continue;
    const roomW=Math.floor(clamp(leaf.w*(0.55+rng()*0.25),6,leaf.w-2));
    const roomH=Math.floor(clamp(leaf.h*(0.55+rng()*0.25),6,leaf.h-2));
    const roomX=leaf.x+1+Math.floor(rng()*Math.max(1,leaf.w-roomW-1));
    const roomY=leaf.y+1+Math.floor(rng()*Math.max(1,leaf.h-roomH-1));
    const room={x:roomX,y:roomY,w:roomW,h:roomH};
    rooms.push(room);
    carveRect(tiles,w,room,0);

    const pillars=Math.floor(rng()*3);
    for(let p=0;p<pillars;p++){
      const px=room.x+2+Math.floor(rng()*Math.max(1,room.w-4));
      const py=room.y+2+Math.floor(rng()*Math.max(1,room.h-4));
      tiles[idx(px,py,w)]=1;
    }
  }

  const center=(r:Rect)=>({x:Math.floor(r.x+r.w/2),y:Math.floor(r.y+r.h/2)});
  const centers=rooms.map(center).sort((a,b)=>(a.x+a.y)-(b.x+b.y));
  for(let i=1;i<centers.length;i++){
    const a=centers[i-1], b=centers[i];
    const horizFirst=rng()<0.5;
    if(horizFirst){
      carveCorridor(tiles,w,a.x,a.y,b.x,a.y);
      carveCorridor(tiles,w,b.x,a.y,b.x,b.y);
    } else {
      carveCorridor(tiles,w,a.x,a.y,a.x,b.y);
      carveCorridor(tiles,w,a.x,b.y,b.x,b.y);
    }
  }

  const start=center(rooms[Math.floor(rng()*rooms.length)]);
  let exit=center(rooms[Math.floor(rng()*rooms.length)]);
  for(let tries=0;tries<50;tries++){
    const cand=center(rooms[Math.floor(rng()*rooms.length)]);
    const d=Math.abs(cand.x-start.x)+Math.abs(cand.y-start.y);
    if(d>(w+h)*0.35){ exit=cand; break; }
  }
  carveRect(tiles,w,{x:exit.x-1,y:exit.y-1,w:3,h:3},0);
  return { seed,w,h,tileSize,tiles,start,exit };
}
