import { DEFAULT_WORD_PACK_ID } from "./constants.js";
import type { CustomWordPackInput, WordCategory, WordEntry, WordPack, WordPackSummary } from "./types.js";

function simpleHash(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const entry = (id: string, text: string, category: WordCategory): WordEntry => ({ id, text, category });

const baseEntries: readonly WordEntry[] = [
  entry("eva", "EVA", "title"),
  entry("gundam", "高达", "title"),
  entry("naruto", "火影忍者", "title"),
  entry("one-piece", "海贼王", "title"),
  entry("bleach", "死神", "title"),
  entry("gintama", "银魂", "title"),
  entry("clannad", "CLANNAD", "title"),
  entry("haruhi", "凉宫春日", "title"),
  entry("k-on", "轻音少女", "title"),
  entry("aot", "进击的巨人", "title"),
  entry("jujutsu", "咒术回战", "title"),
  entry("frieren", "葬送的芙莉莲", "title"),
  entry("bocchi", "孤独摇滚", "title"),
  entry("fgo", "FGO", "title"),
  entry("genshin", "原神", "title"),
  entry("star-rail", "星穹铁道", "title"),
  entry("arknights", "明日方舟", "title"),
  entry("vocaloid", "Vocaloid", "title"),
  entry("madoka", "魔法少女小圆", "title"),
  entry("steins-gate", "命运石之门", "title"),
  entry("railgun", "某科学的超电磁炮", "title"),
  entry("love-live", "LoveLive", "title"),
  entry("umamusume", "赛马娘", "title"),
  entry("blue-archive", "碧蓝档案", "title"),
  entry("nier", "尼尔", "title"),
  entry("persona", "女神异闻录", "title"),
  entry("saber", "Saber", "character"),
  entry("shinji", "碇真嗣", "character"),
  entry("rei", "绫波丽", "character"),
  entry("asuka", "明日香", "character"),
  entry("gojo", "五条悟", "character"),
  entry("itadori", "虎杖悠仁", "character"),
  entry("tanjiro", "炭治郎", "character"),
  entry("nezuko", "祢豆子", "character"),
  entry("luffy", "路飞", "character"),
  entry("zoro", "索隆", "character"),
  entry("naruto-hero", "鸣人", "character"),
  entry("sasuke", "佐助", "character"),
  entry("gintoki", "坂田银时", "character"),
  entry("miku", "初音未来", "character"),
  entry("mikasa", "三笠", "character"),
  entry("levi", "利威尔", "character"),
  entry("misaka", "御坂美琴", "character"),
  entry("okabe", "冈部伦太郎", "character"),
  entry("kurisu", "牧濑红莉栖", "character"),
  entry("bocchi-char", "后藤一里", "character"),
  entry("himmel", "辛美尔", "character"),
  entry("march7th", "三月七", "character"),
  entry("kafka", "卡芙卡", "character"),
  entry("amiya", "阿米娅", "character"),
  entry("exusiai", "能天使", "character"),
  entry("kiana", "琪亚娜", "character"),
  entry("raiden-mei", "雷电芽衣", "character"),
  entry("hutao", "胡桃", "character"),
  entry("nahida", "纳西妲", "character"),
  entry("furina", "芙宁娜", "character"),
  entry("rhodes", "罗德岛", "organization"),
  entry("akatsuki", "晓组织", "organization"),
  entry("strawhats", "草帽团", "organization"),
  entry("survey-corps", "调查兵团", "organization"),
  entry("seireitei", "尸魂界", "organization"),
  entry("chaldea", "迦勒底", "organization"),
  entry("fatui", "愚人众", "organization"),
  entry("astral-express", "星穹列车", "organization"),
  entry("student-council", "学生会", "organization"),
  entry("idol-unit", "偶像团", "organization"),
  entry("nerv", "NERV", "organization"),
  entry("school-club", "轻音部", "organization"),
  entry("tsundere", "傲娇", "trope"),
  entry("yandere", "病娇", "trope"),
  entry("kuudere", "三无", "trope"),
  entry("isekai", "异世界", "trope"),
  entry("mecha", "机甲", "trope"),
  entry("magical-girl", "魔法少女", "trope"),
  entry("hot-blood", "热血", "trope"),
  entry("healing", "治愈", "trope"),
  entry("cyberpunk", "赛博朋克", "trope"),
  entry("onsen", "温泉回", "trope"),
  entry("beach", "泳装回", "trope"),
  entry("cat-ears", "猫耳", "trope"),
  entry("maid", "女仆", "trope"),
  entry("shrine-maiden", "巫女", "trope"),
  entry("demon-king", "魔王", "trope"),
  entry("hero-party", "勇者小队", "trope"),
  entry("time-loop", "时间循环", "trope"),
  entry("school-festival", "学园祭", "trope"),
  entry("childhood-friend", "青梅竹马", "trope"),
  entry("idol", "偶像", "trope"),
  entry("director", "监督", "production"),
  entry("storyboard", "分镜", "production"),
  entry("sakuga", "作画", "production"),
  entry("genga", "原画", "production"),
  entry("seiyuu", "声优", "production"),
  entry("op", "OP", "production"),
  entry("ed", "ED", "production"),
  entry("movie", "剧场版", "production"),
  entry("adaptation", "漫改", "production"),
  entry("visual-novel", "视觉小说", "production"),
  entry("figure", "手办", "fandom"),
  entry("goods", "谷子", "fandom"),
  entry("cp", "CP", "fandom"),
  entry("canon", "官配", "fandom"),
  entry("oshi", "推角", "fandom"),
  entry("waifu", "老婆", "fandom"),
  entry("husbando", "老公", "fandom"),
  entry("cosplay", "Cosplay", "fandom"),
  entry("pilgrimage", "圣地巡礼", "fandom"),
  entry("famous-scene", "名场面", "fandom"),
  entry("knife", "发刀", "fandom"),
  entry("sugar", "发糖", "fandom"),
  entry("recommend", "安利", "fandom"),
  entry("catch-up", "补番", "fandom"),
  entry("join-fandom", "入坑", "fandom"),
  entry("ten-pull", "十连", "fandom")
];

export const defaultWordPack: WordPack = {
  id: DEFAULT_WORD_PACK_ID,
  name: "二次元核心词包",
  description: "覆盖动画、漫画、游戏和圈内常见梗的默认题库。",
  entries: baseEntries,
  isBuiltin: true
};

export const wordPacks: readonly WordPack[] = [defaultWordPack];

export function toWordPackSummary(pack: WordPack): WordPackSummary {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    entryCount: pack.entries.length,
    isBuiltin: pack.isBuiltin
  };
}

export const wordPackSummaries: readonly WordPackSummary[] = wordPacks.map(toWordPackSummary);

export function getBuiltinWordPackById(wordPackId: string): WordPack | null {
  return wordPacks.find((pack) => pack.id === wordPackId) ?? null;
}

export function createCustomWordPack(input: CustomWordPackInput): WordPack {
  const cleanedEntries = Array.from(
    new Set(
      input.entries
        .map((entryText) => entryText.trim())
        .filter(Boolean)
    )
  );

  const entries: WordEntry[] = cleanedEntries.map((text, index) => ({
    id: `custom-${index}-${simpleHash(text)}`,
    text,
    category: "custom"
  }));

  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim() || "自定义题库",
    description: "玩家上传的房间专用题库。",
    entries
  };
}
