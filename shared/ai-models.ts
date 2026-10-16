// IDs verified against the local WorkBuddy /v1/models catalog on 2026-10-16.
export const betaModels=[
 {id:'cn:glm-5.3',name:'GLM 5.3'}, {id:'cn:glm-5.3-flash',name:'GLM 5.3 Flash'},
 {id:'cn:glm-5.2',name:'GLM 5.2'}, {id:'cn:glm-5.1',name:'GLM 5.1'},
 {id:'cn:glm-5v-turbo',name:'GLM 5V Turbo · 图片'},
 {id:'cn:kimi-k3-1',name:'KIMI K3.1'}, {id:'cn:kimi-k2.8-preview',name:'KIMI K2.8 Preview'},
 {id:'cn:kimi-k2.7',name:'KIMI K2.7'}, {id:'cn:kimi-k2.6',name:'KIMI K2.6'},
];
export const visionChoices=betaModels.filter(m=>m.id==='cn:glm-5v-turbo');
export type AIUsage={day:string;used:number;limit:number;remaining:number;model:string;visionModel:string;guest:boolean};
