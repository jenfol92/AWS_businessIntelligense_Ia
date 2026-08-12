export type CreditReleaseLine = { id:string; creditLimit:number; availableAmount:number };

export function createCreditReleaseTracker(lines:CreditReleaseLine[]){
  const remaining=new Map(lines.map(line=>[line.id,Math.max(line.creditLimit-line.availableAmount,0)]));
  return {
    take(lineId:string|null|undefined,requested:number){
      if(!lineId)return 0;
      const capacity=remaining.get(lineId)??0;
      const released=Math.min(Math.max(requested,0),capacity);
      remaining.set(lineId,capacity-released);
      return released;
    },
    remaining(lineId:string){return remaining.get(lineId)??0;},
  };
}
