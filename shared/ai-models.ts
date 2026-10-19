// IDs verified against the local WorkBuddy /v1/models catalog on 2026-10-16.
export const betaModels=[
 {id:'global:deepseek-v4.1-flash',name:'DeepSeek 4.1 Flash'},
 {id:'cn:glm-5.3',name:'GLM 5.3'}, {id:'cn:glm-5.3-flash',name:'GLM 5.3 Flash'},
 {id:'cn:glm-5v-turbo',name:'GLM 5V Turbo · 图片'},
 {id:'cn:kimi-k3-1',name:'KIMI K3.1'}, {id:'cn:kimi-k2.8-preview',name:'KIMI K2.8 Preview'},
 {id:'cn:kimi-k2.7',name:'KIMI K2.7'}, {id:'cn:kimi-k2.6',name:'KIMI K2.6'},
];
export const visionChoices=betaModels.filter(m=>['global:deepseek-v4.1-flash','cn:glm-5v-turbo'].includes(m.id));
export const modelName=(id:string)=>betaModels.find(m=>m.id===id)?.name||id;
export type AIUsage={day:string;used:number;limit:number;remaining:number;model:string;visionModel:string;defaultModel:string;defaultVisionModel:string;guest:boolean};

export const modelStatus:Record<string,string>={'cn:glm-5.3-flash':'已实测可用','cn:kimi-k2.8-preview':'已实测可用','cn:kimi-k2.7':'已实测可用','cn:kimi-k3-1':'最近返回503','cn:kimi-k2.6':'最近返回503','cn:glm-5v-turbo':'最近返回503'};
