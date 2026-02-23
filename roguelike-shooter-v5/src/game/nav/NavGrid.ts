import type { MapData, MapTile } from "../procgen/MapGen";
export type Point = { x: number; y: number };

function idx(x:number,y:number,w:number){ return y*w+x; }
function inBounds(x:number,y:number,w:number,h:number){ return x>=0&&y>=0&&x<w&&y<h; }

export class NavGrid {
  public readonly w:number;
  public readonly h:number;
  public readonly tileSize:number;
  private readonly tiles:MapTile[];

  constructor(map:MapData){
    this.w=map.w; this.h=map.h; this.tileSize=map.tileSize; this.tiles=map.tiles;
  }

  isWall(tx:number,ty:number){ if(!inBounds(tx,ty,this.w,this.h)) return true; return this.tiles[idx(tx,ty,this.w)]===1; }
  isWalkable(tx:number,ty:number){ if(!inBounds(tx,ty,this.w,this.h)) return false; return this.tiles[idx(tx,ty,this.w)]===0; }

  toWorldCenter(tx:number,ty:number):Point{ return { x: tx*this.tileSize + this.tileSize/2, y: ty*this.tileSize + this.tileSize/2 }; }
  toTile(x:number,y:number):Point{ return { x: Math.floor(x/this.tileSize), y: Math.floor(y/this.tileSize) }; }

  neighbors4(tx:number,ty:number):Point[]{
    const n=[{x:tx+1,y:ty},{x:tx-1,y:ty},{x:tx,y:ty+1},{x:tx,y:ty-1}];
    return n.filter(p=>this.isWalkable(p.x,p.y));
  }

  hasLineOfSightWorld(ax:number,ay:number,bx:number,by:number){
    const a=this.toTile(ax,ay), b=this.toTile(bx,by);
    return this.hasLineOfSightTiles(a.x,a.y,b.x,b.y);
  }

  hasLineOfSightTiles(x0:number,y0:number,x1:number,y1:number){
    let dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
    let sx=x0<x1?1:-1, sy=y0<y1?1:-1;
    let err=dx-dy;
    let x=x0,y=y0;
    for(let i=0;i<4000;i++){
      if(!inBounds(x,y,this.w,this.h)) return false;
      if(this.isWall(x,y)) return false;
      if(x===x1 && y===y1) return true;
      const e2=2*err;
      if(e2>-dy){ err-=dy; x+=sx; }
      if(e2< dx){ err+=dx; y+=sy; }
    }
    return false;
  }

  findPathWorld(fromX:number,fromY:number,toX:number,toY:number):Point[]{
    const s=this.toTile(fromX,fromY), g=this.toTile(toX,toY);
    return this.findPathTiles(s.x,s.y,g.x,g.y).map(p=>this.toWorldCenter(p.x,p.y));
  }

  findPathTiles(sx:number,sy:number,gx:number,gy:number):Point[]{
    if(!this.isWalkable(sx,sy)||!this.isWalkable(gx,gy)) return [];
    const open:Point[]=[{x:sx,y:sy}];
    const cameFrom=new Map<number,number>();
    const gScore=new Map<number,number>();
    const fScore=new Map<number,number>();
    const inOpen=new Set<number>();
    const sKey=idx(sx,sy,this.w);
    gScore.set(sKey,0);
    fScore.set(sKey,this.hManhattan(sx,sy,gx,gy));
    inOpen.add(sKey);

    while(open.length>0){
      let bestI=0,bestF=Infinity;
      for(let i=0;i<open.length;i++){
        const p=open[i], k=idx(p.x,p.y,this.w);
        const f=fScore.get(k)??Infinity;
        if(f<bestF){ bestF=f; bestI=i; }
      }
      const cur=open.splice(bestI,1)[0];
      const ck=idx(cur.x,cur.y,this.w);
      inOpen.delete(ck);

      if(cur.x===gx && cur.y===gy) return this.reconstruct(cameFrom,ck);

      for(const nb of this.neighbors4(cur.x,cur.y)){
        const nk=idx(nb.x,nb.y,this.w);
        const tentative=(gScore.get(ck)??Infinity)+1;
        if(tentative < (gScore.get(nk)??Infinity)){
          cameFrom.set(nk,ck);
          gScore.set(nk,tentative);
          fScore.set(nk,tentative+this.hManhattan(nb.x,nb.y,gx,gy));
          if(!inOpen.has(nk)){ open.push(nb); inOpen.add(nk); }
        }
      }
    }
    return [];
  }

  computeCoverPoints():Point[]{
    const pts:Point[]=[];
    for(let y=1;y<this.h-1;y++){
      for(let x=1;x<this.w-1;x++){
        if(!this.isWalkable(x,y)) continue;
        const adj=this.isWall(x+1,y)||this.isWall(x-1,y)||this.isWall(x,y+1)||this.isWall(x,y-1);
        if(adj) pts.push(this.toWorldCenter(x,y));
      }
    }
    return pts;
  }

  private reconstruct(cameFrom:Map<number,number>, currentKey:number):Point[]{
    const keys=[currentKey];
    while(cameFrom.has(currentKey)){
      currentKey=cameFrom.get(currentKey)!;
      keys.push(currentKey);
    }
    keys.reverse();
    return keys.map(k=>({ x: k%this.w, y: Math.floor(k/this.w) }));
  }

  private hManhattan(ax:number,ay:number,bx:number,by:number){ return Math.abs(ax-bx)+Math.abs(ay-by); }
}
