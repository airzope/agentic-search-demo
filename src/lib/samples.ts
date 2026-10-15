import type { Settings } from "meilisearch";

/**
 * Small CJK demo datasets with the settings we recommend for each language.
 * They are meant to make segmentation, synonyms and hybrid search tangible.
 */
export type SampleDoc = {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string[];
};

export type SampleDataset = {
  id: "zh" | "ja" | "ko";
  indexUid: string;
  label: string;
  locale: string;
  settings: Settings;
  /** Example questions for the chat page. */
  questions: string[];
  /** Example text for the tokenization preview. */
  previewText: string;
  documents: SampleDoc[];
};

const base: Settings = {
  searchableAttributes: ["title", "tags", "content"],
  filterableAttributes: ["category", "tags"],
  displayedAttributes: ["*"],
};

const zh: SampleDataset = {
  id: "zh",
  indexUid: "demo_zh",
  label: "中文 · 科技与城市",
  locale: "cmn",
  questions: [
    "混合搜索和向量检索有什么区别？",
    "南京有哪些著名的建筑？",
    "推荐几道四川菜",
    "电脑是怎么发展起来的？",
  ],
  previewText:
    "南京市长江大桥是中国自行设计建造的第一座长江大桥。混合搜索结合了关键词检索与向量检索。",
  settings: {
    ...base,
    localizedAttributes: [
      { attributePatterns: ["title", "content", "tags"], locales: ["cmn"] },
    ],
    dictionary: [
      "长江大桥",
      "混合搜索",
      "向量检索",
      "倒排索引",
      "检索增强生成",
    ],
    synonyms: {
      电脑: ["计算机", "PC"],
      计算机: ["电脑", "PC"],
      PC: ["电脑", "计算机"],
      手机: ["移动电话", "智能手机"],
      移动电话: ["手机", "智能手机"],
      智能手机: ["手机", "移动电话"],
      AI: ["人工智能"],
      人工智能: ["AI"],
      大模型: ["大语言模型", "LLM"],
      大语言模型: ["大模型", "LLM"],
      LLM: ["大模型", "大语言模型"],
      RAG: ["检索增强生成"],
      台湾: ["臺灣"],
      臺灣: ["台湾"],
    },
  },
  documents: [
    {
      id: 1,
      title: "南京长江大桥",
      content:
        "南京长江大桥是长江上第一座由中国自行设计和建造的双层式铁路、公路两用桥梁，1968年建成通车。上层为公路桥，下层为双线铁路桥，曾是南京市的重要地标。",
      category: "城市",
      tags: ["南京", "桥梁", "地标"],
    },
    {
      id: 2,
      title: "中文分词是什么",
      content:
        "中文书写没有空格，搜索引擎需要先把句子切分成词语才能建立索引，这个过程叫中文分词。常见方法有基于词典的最大匹配、基于统计的隐马尔可夫模型以及深度学习模型。jieba 是最常用的开源中文分词工具之一。",
      category: "科技",
      tags: ["分词", "自然语言处理", "jieba"],
    },
    {
      id: 3,
      title: "倒排索引的原理",
      content:
        "倒排索引记录每个词出现在哪些文档中，是全文检索的核心数据结构。查询时先对关键词分词，再合并各个词的文档列表，最后按相关度排序返回结果。",
      category: "科技",
      tags: ["搜索引擎", "索引", "全文检索"],
    },
    {
      id: 4,
      title: "向量检索入门",
      content:
        "向量检索把文本转换成高维向量，通过计算余弦相似度来查找语义相近的内容。即使用户的提问和文档没有共同的关键词，也能找到意思接近的结果，常用于问答和推荐。",
      category: "科技",
      tags: ["向量", "语义搜索", "嵌入"],
    },
    {
      id: 5,
      title: "混合搜索：关键词与语义的结合",
      content:
        "混合搜索同时使用关键词检索和向量检索，再把两路结果融合排序。关键词检索擅长精确匹配专有名词和编号，向量检索擅长理解同义表达，两者结合可以显著提升召回率和准确率。",
      category: "科技",
      tags: ["混合搜索", "向量", "排序"],
    },
    {
      id: 6,
      title: "大语言模型简介",
      content:
        "大语言模型是在海量文本上训练的神经网络，能够理解和生成自然语言。它可以回答问题、写作、翻译和编写代码，但也可能产生不准确的内容，因此常与检索系统配合使用。",
      category: "科技",
      tags: ["大模型", "人工智能", "LLM"],
    },
    {
      id: 7,
      title: "检索增强生成",
      content:
        "检索增强生成先从知识库中检索与问题相关的文档，再把这些文档交给大语言模型作答。这样可以让回答有据可查、减少幻觉，也能让模型使用最新的私有数据。",
      category: "科技",
      tags: ["RAG", "知识库", "问答"],
    },
    {
      id: 8,
      title: "自然语言处理的应用",
      content:
        "自然语言处理让计算机理解人类语言，应用包括机器翻译、情感分析、文本分类、信息抽取和智能客服。分词、词性标注和命名实体识别是中文处理的基础任务。",
      category: "科技",
      tags: ["自然语言处理", "人工智能"],
    },
    {
      id: 9,
      title: "机器学习的三种类型",
      content:
        "机器学习通常分为监督学习、无监督学习和强化学习。监督学习从带标签的数据中学习，无监督学习发现数据中的结构，强化学习通过与环境交互获得奖励来改进策略。",
      category: "科技",
      tags: ["机器学习", "人工智能"],
    },
    {
      id: 10,
      title: "计算机发展简史",
      content:
        "从占满整个房间的电子管计算机，到晶体管和集成电路，再到今天人手一台的个人电脑，计算机的体积不断缩小而性能飞速提升。摩尔定律描述了芯片上晶体管数量大约每两年翻一番的趋势。",
      category: "科技",
      tags: ["计算机", "历史", "芯片"],
    },
    {
      id: 11,
      title: "智能手机如何改变生活",
      content:
        "智能手机集通信、拍照、导航和移动支付于一身。在中国，扫码支付和外卖、网约车等应用让手机成为日常生活中不可缺少的工具。",
      category: "科技",
      tags: ["手机", "移动互联网"],
    },
    {
      id: 12,
      title: "北京故宫",
      content:
        "故宫位于北京中轴线的中心，是明清两代的皇家宫殿，旧称紫禁城。它是世界上现存规模最大、保存最完整的木质结构古建筑群之一，现为故宫博物院。",
      category: "城市",
      tags: ["北京", "古建筑", "博物馆"],
    },
    {
      id: 13,
      title: "杭州西湖",
      content:
        "西湖位于浙江省杭州市西部，以湖光山色和众多名胜古迹闻名，断桥残雪、苏堤春晓、雷峰夕照都是著名景点。2011年西湖文化景观被列入世界遗产名录。",
      category: "城市",
      tags: ["杭州", "湖泊", "世界遗产"],
    },
    {
      id: 14,
      title: "上海外滩",
      content:
        "外滩位于上海黄浦江西岸，汇集了数十栋风格各异的历史建筑，被称为万国建筑博览群。对岸的陆家嘴有东方明珠和上海中心大厦，夜景尤其壮观。",
      category: "城市",
      tags: ["上海", "建筑", "夜景"],
    },
    {
      id: 15,
      title: "成都与大熊猫",
      content:
        "成都是四川省省会，以悠闲的生活节奏和麻辣美食著称。成都大熊猫繁育研究基地是观察大熊猫的热门去处，春熙路和宽窄巷子也吸引了大量游客。",
      category: "城市",
      tags: ["成都", "四川", "大熊猫"],
    },
    {
      id: 16,
      title: "西安兵马俑",
      content:
        "秦始皇兵马俑位于陕西省西安市临潼区，是秦始皇陵的陪葬坑。数千件陶俑和陶马形态各异，被誉为世界第八大奇迹。",
      category: "城市",
      tags: ["西安", "陕西", "考古"],
    },
    {
      id: 17,
      title: "北京烤鸭",
      content:
        "北京烤鸭皮脆肉嫩，通常配以薄饼、葱丝、黄瓜条和甜面酱食用。挂炉和焖炉是两种主要的烤制方法。",
      category: "美食",
      tags: ["北京", "鸭", "名菜"],
    },
    {
      id: 18,
      title: "麻婆豆腐",
      content:
        "麻婆豆腐是经典川菜，以豆腐、牛肉末、豆瓣酱和花椒烹制，特点是麻、辣、烫、香、酥、嫩。正宗做法讲究用郫县豆瓣和汉源花椒。",
      category: "美食",
      tags: ["四川", "川菜", "豆腐"],
    },
    {
      id: 19,
      title: "回锅肉",
      content:
        "回锅肉被称为川菜之首，先把五花肉煮熟切片，再与蒜苗、豆瓣酱一起回锅爆炒，咸香微辣，非常下饭。",
      category: "美食",
      tags: ["四川", "川菜", "猪肉"],
    },
    {
      id: 20,
      title: "小笼包",
      content:
        "小笼包是江南地区的传统点心，以上海南翔小笼和无锡小笼最有名。皮薄馅多，咬开后汤汁鲜美，吃时可蘸香醋和姜丝。",
      category: "美食",
      tags: ["上海", "点心", "江南"],
    },
    {
      id: 21,
      title: "春节习俗",
      content:
        "春节是农历新年，也是中国最重要的传统节日。人们贴春联、放鞭炮、吃年夜饭、守岁，长辈会给孩子压岁钱，各地还有舞龙舞狮和逛庙会等活动。",
      category: "文化",
      tags: ["节日", "春节", "传统"],
    },
    {
      id: 22,
      title: "中秋节",
      content:
        "中秋节在农历八月十五，人们赏月、吃月饼、与家人团聚。嫦娥奔月的传说为这个节日增添了浪漫色彩。",
      category: "文化",
      tags: ["节日", "月饼", "传统"],
    },
    {
      id: 23,
      title: "中国茶文化",
      content:
        "中国是茶的故乡，茶分为绿茶、红茶、乌龙茶、白茶、黄茶和黑茶六大类。西湖龙井、碧螺春和铁观音都是名茶，功夫茶讲究器具和冲泡的步骤。",
      category: "文化",
      tags: ["茶", "传统", "饮品"],
    },
    {
      id: 24,
      title: "繁体与简体：臺灣與香港的用字",
      content:
        "臺灣和香港通行繁體中文，大陆通行简体中文。搜索引擎不会自动在繁简之间转换，例如「臺灣」和「台湾」被视为不同的词，可以通过同义词或词典让两者互通。",
      category: "文化",
      tags: ["汉字", "繁体", "简体"],
    },
  ],
};

const ja: SampleDataset = {
  id: "ja",
  indexUid: "demo_ja",
  label: "日本語 · 文化と技術",
  locale: "jpn",
  questions: [
    "京都でおすすめのお寺は？",
    "形態素解析とは何ですか？",
    "日本のラーメンの種類を教えて",
  ],
  previewText:
    "東京タワーから富士山が見えました。形態素解析は日本語の検索に欠かせません。",
  settings: {
    ...base,
    localizedAttributes: [
      { attributePatterns: ["title", "content", "tags"], locales: ["jpn"] },
    ],
    dictionary: ["形態素解析", "東京タワー", "全文検索"],
    synonyms: {
      寿司: ["すし", "鮨"],
      すし: ["寿司", "鮨"],
      鮨: ["寿司", "すし"],
      ラーメン: ["拉麺"],
      拉麺: ["ラーメン"],
    },
  },
  documents: [
    {
      id: 1,
      title: "東京タワー",
      content:
        "東京タワーは1958年に完成した高さ333メートルの電波塔です。展望台からは東京の街並みを一望でき、天気の良い日には富士山も見えます。",
      category: "観光",
      tags: ["東京", "ランドマーク"],
    },
    {
      id: 2,
      title: "京都の寺院",
      content:
        "京都には清水寺、金閣寺、銀閣寺など多くの歴史ある寺院があります。春の桜や秋の紅葉の季節には、国内外から多くの観光客が訪れます。",
      category: "観光",
      tags: ["京都", "寺院", "世界遺産"],
    },
    {
      id: 3,
      title: "富士山",
      content:
        "富士山は標高3776メートルの日本最高峰で、2013年に世界文化遺産に登録されました。夏の登山シーズンには多くの人が山頂を目指します。",
      category: "観光",
      tags: ["山", "世界遺産"],
    },
    {
      id: 4,
      title: "寿司の歴史",
      content:
        "寿司はもともと魚を保存するための発酵食品でした。江戸時代に握り寿司が生まれ、今では回転寿司として世界中で親しまれています。",
      category: "料理",
      tags: ["和食", "魚"],
    },
    {
      id: 5,
      title: "ラーメンの種類",
      content:
        "日本のラーメンには醤油、味噌、塩、豚骨などの種類があります。札幌の味噌ラーメン、博多の豚骨ラーメンなど、地域ごとに特色があります。",
      category: "料理",
      tags: ["麺類", "ご当地グルメ"],
    },
    {
      id: 6,
      title: "花見の文化",
      content:
        "春になると、人々は桜の木の下に集まって花見を楽しみます。満開の時期は地域によって異なり、天気予報では桜前線が伝えられます。",
      category: "文化",
      tags: ["桜", "春", "行事"],
    },
    {
      id: 7,
      title: "形態素解析とは",
      content:
        "日本語の文章は単語の間にスペースがないため、検索エンジンは形態素解析によって文を単語に分割します。MeCab や Lindera などの解析器が辞書を使って品詞を判定します。",
      category: "技術",
      tags: ["自然言語処理", "分かち書き"],
    },
    {
      id: 8,
      title: "全文検索エンジンの仕組み",
      content:
        "全文検索エンジンは転置インデックスを使い、キーワードを含む文書を高速に探します。最近はベクトル検索と組み合わせたハイブリッド検索も広く使われています。",
      category: "技術",
      tags: ["検索", "インデックス"],
    },
    {
      id: 9,
      title: "新幹線",
      content:
        "新幹線は1964年に東海道新幹線として開業した高速鉄道です。最高時速は300キロを超え、正確な運行と高い安全性で知られています。",
      category: "技術",
      tags: ["鉄道", "交通"],
    },
    {
      id: 10,
      title: "漫画とアニメ",
      content:
        "日本の漫画とアニメは世界中にファンがいます。週刊誌で連載された作品がアニメ化され、映画やゲームへと展開されることも多いです。",
      category: "文化",
      tags: ["ポップカルチャー"],
    },
  ],
};

const ko: SampleDataset = {
  id: "ko",
  indexUid: "demo_ko",
  label: "한국어 · 문화와 기술",
  locale: "kor",
  questions: [
    "서울에서 가볼 만한 곳은?",
    "형태소 분석이 왜 필요한가요?",
    "김치의 종류를 알려 주세요",
  ],
  previewText:
    "서울특별시의 경복궁은 조선 시대의 궁궐입니다. 한국어 검색엔진은 형태소 분석을 사용합니다.",
  settings: {
    ...base,
    localizedAttributes: [
      { attributePatterns: ["title", "content", "tags"], locales: ["kor"] },
    ],
    dictionary: ["검색엔진", "형태소"],
    synonyms: {
      "검색 엔진": ["검색엔진"],
      검색엔진: ["검색 엔진"],
    },
  },
  documents: [
    {
      id: 1,
      title: "서울",
      content:
        "서울은 대한민국의 수도로, 한강을 중심으로 발전한 대도시입니다. 남산서울타워와 명동, 홍대 거리는 관광객에게 인기가 많습니다.",
      category: "여행",
      tags: ["도시", "수도"],
    },
    {
      id: 2,
      title: "경복궁",
      content:
        "경복궁은 1395년에 세워진 조선 왕조의 첫 번째 궁궐입니다. 한복을 입고 방문하면 입장료가 무료이며, 수문장 교대식도 볼 수 있습니다.",
      category: "여행",
      tags: ["궁궐", "역사"],
    },
    {
      id: 3,
      title: "부산",
      content:
        "부산은 한국 제2의 도시이자 최대의 항구 도시입니다. 해운대 해수욕장과 감천문화마을, 자갈치 시장이 유명합니다.",
      category: "여행",
      tags: ["도시", "바다"],
    },
    {
      id: 4,
      title: "제주도",
      content:
        "제주도는 화산 활동으로 만들어진 섬으로, 한라산과 성산일출봉이 유네스코 세계자연유산에 등재되어 있습니다.",
      category: "여행",
      tags: ["섬", "자연"],
    },
    {
      id: 5,
      title: "한글의 창제",
      content:
        "한글은 1443년 세종대왕이 창제한 문자로, 자음과 모음을 조합하여 음절을 만듭니다. 배우기 쉽고 과학적인 문자로 평가받습니다.",
      category: "문화",
      tags: ["문자", "역사"],
    },
    {
      id: 6,
      title: "김치",
      content:
        "김치는 배추나 무를 소금에 절인 뒤 고춧가루, 마늘, 젓갈 등으로 양념하여 발효시킨 음식입니다. 배추김치, 깍두기, 동치미 등 종류가 다양합니다.",
      category: "음식",
      tags: ["발효", "전통"],
    },
    {
      id: 7,
      title: "비빔밥",
      content:
        "비빔밥은 밥 위에 여러 가지 나물과 고기, 달걀을 올리고 고추장과 함께 비벼 먹는 음식입니다. 전주 비빔밥이 특히 유명합니다.",
      category: "음식",
      tags: ["밥", "전통"],
    },
    {
      id: 8,
      title: "형태소 분석",
      content:
        "한국어는 조사와 어미가 단어에 붙는 교착어이기 때문에, 검색엔진은 형태소 분석으로 어간과 조사를 분리합니다. 예를 들어 '학교에서'는 '학교'와 '에서'로 나뉩니다.",
      category: "기술",
      tags: ["자연어 처리", "검색"],
    },
    {
      id: 9,
      title: "검색 엔진과 벡터 검색",
      content:
        "검색 엔진은 역색인을 이용해 키워드가 포함된 문서를 빠르게 찾습니다. 벡터 검색을 함께 사용하면 의미가 비슷한 문서도 찾을 수 있습니다.",
      category: "기술",
      tags: ["검색", "인공지능"],
    },
    {
      id: 10,
      title: "K-팝",
      content:
        "K-팝은 한국의 대중음악으로, 화려한 퍼포먼스와 아이돌 그룹으로 전 세계적인 인기를 얻고 있습니다.",
      category: "문화",
      tags: ["음악", "한류"],
    },
  ],
};

export const SAMPLE_DATASETS: SampleDataset[] = [zh, ja, ko];

export const getSampleDataset = (id: string) =>
  SAMPLE_DATASETS.find((dataset) => dataset.id === id);

export const getSampleByIndex = (indexUid: string) =>
  SAMPLE_DATASETS.find((dataset) => dataset.indexUid === indexUid);

/** Language presets offered when creating a new index. */
export const LANGUAGE_PRESETS = [
  { id: "none", locales: [] as string[] },
  { id: "cmn", locales: ["cmn"] },
  { id: "jpn", locales: ["jpn"] },
  { id: "kor", locales: ["kor"] },
  { id: "cmn-eng", locales: ["cmn", "eng"] },
] as const;
