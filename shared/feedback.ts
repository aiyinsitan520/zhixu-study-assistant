import {z} from 'zod';
export const FEEDBACK_REWARD=1000;
export const feedbackCategories={bug:'Bug / 操作异常',content:'题目或解析纠错',suggestion:'功能建议',other:'其他问题'};
export const feedbackStatuses={pending:'待处理',reviewing:'查看中',adopted:'已采纳',resolved:'已解决',declined:'暂不采纳'};
export const feedbackInput=z.object({submissionId:z.string().uuid().optional(),category:z.enum(['bug','content','suggestion','other']).default('bug'),title:z.string().trim().min(1).max(100),content:z.string().trim().min(1).max(10000),page:z.string().trim().max(300).default(''),images:z.array(z.string().regex(/^[a-zA-Z0-9-]+$/)).max(3).default([])});
export const feedbackSchema=feedbackInput.omit({submissionId:true}).extend({id:z.string().uuid(),ownerId:z.string().uuid(),authorName:z.string().max(30),username:z.string().max(32),status:z.enum(['pending','reviewing','adopted','resolved','declined']),reply:z.string().max(6000),rewardCoins:z.union([z.literal(0),z.literal(1000)]),awardedAt:z.string().optional(),adminId:z.string().uuid().optional(),createdAt:z.string(),updatedAt:z.string()});
export const feedbackAwardSchema=z.object({id:z.string().regex(/^feedback-[a-zA-Z0-9-]+$/),feedbackId:z.string().uuid(),ownerId:z.string().uuid(),coins:z.literal(1000),createdAt:z.string()});
export type Feedback=z.infer<typeof feedbackSchema>;
export type FeedbackAward=z.infer<typeof feedbackAwardSchema>;
