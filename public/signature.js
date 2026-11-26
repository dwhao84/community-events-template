// Normalized points survive viewport rotation and print at any resolution.
export function paintSignature(canvas,strokes){
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle='#123';ctx.fillStyle='#123';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.lineJoin='round';
 for(const line of strokes){ctx.beginPath();line.forEach(([x,y],i)=>i?ctx.lineTo(x*canvas.width,y*canvas.height):ctx.moveTo(x*canvas.width,y*canvas.height));ctx.stroke();if(line.length===1){ctx.beginPath();ctx.arc(line[0][0]*canvas.width,line[0][1]*canvas.height,1.5,0,Math.PI*2);ctx.fill();}}
}
export function signaturePad(canvas,initial=[]){
 let strokes=structuredClone(initial),active=null;
 const point=e=>{const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];};
 canvas.onpointerdown=e=>{if(active!==null||strokes.length>=100)return;e.preventDefault();active=e.pointerId;canvas.setPointerCapture(active);strokes.push([point(e)]);paintSignature(canvas,strokes);};
 canvas.onpointermove=e=>{if(active!==e.pointerId)return;const line=strokes.at(-1);if(line.length<1000&&JSON.stringify(strokes).length<18000)line.push(point(e).map(n=>Math.round(n*1000)/1000));paintSignature(canvas,strokes);};
 canvas.onpointerup=canvas.onpointercancel=e=>{if(active===e.pointerId)active=null;};
 paintSignature(canvas,strokes);
 return {read:()=>structuredClone(strokes),clear:()=>{strokes=[];paintSignature(canvas,strokes);},undo:()=>{strokes.pop();paintSignature(canvas,strokes);}};
}
