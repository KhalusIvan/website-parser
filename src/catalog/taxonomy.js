// One category tree for the whole catalog (product type based; the brand is a separate field) and
// rules that put a supplier's product into it, from the supplier's category path and the product name.

/** [id, parent id, Ukrainian name, Russian name] in display order. */
const TREE = [
  ['tech', null, 'Техніка для перукарів і барберів', 'Техника для парикмахеров и барберов'],
  ['tech-clippers', 'tech', 'Машинки для стрижки', 'Машинки для стрижки'],
  ['tech-trimmers', 'tech', 'Тримери для стрижки', 'Триммеры для стрижки'],
  ['tech-shavers', 'tech', 'Шейвери та електробритви', 'Шейверы и электробритвы'],
  ['tech-nose', 'tech', 'Тримери для носа і вух', 'Триммеры для носа и ушей'],
  ['tech-sets', 'tech', 'Набори техніки для стрижки', 'Наборы техники для стрижки'],
  ['tech-dryers', 'tech', 'Фени для волосся', 'Фены для волос'],
  ['tech-airstylers', 'tech', 'Фен-щітки та стайлери', 'Фен-щетки и стайлеры'],
  ['tech-straighteners', 'tech', 'Випрямлячі для волосся', 'Выпрямители для волос'],
  ['tech-curlers', 'tech', 'Плойки для волосся', 'Плойки для волос'],
  ['tech-crimpers', 'tech', 'Гофре для волосся', 'Гофре для волос'],
  ['tech-hotrollers', 'tech', 'Електробігуді', 'Электробигуди'],

  ['parts', null, 'Комплектуючі та запчастини', 'Комплектующие и запчасти'],
  ['parts-blades', 'parts', 'Ножові блоки та ножі', 'Ножевые блоки и ножи'],
  ['parts-shaver', 'parts', 'Сітки та ножі для шейверів', 'Сетки и ножи для шейверов'],
  ['parts-guides', 'parts', 'Насадки для машинок і тримерів', 'Насадки для машинок и триммеров'],
  ['parts-dryer', 'parts', 'Насадки та дифузори для фенів', 'Насадки и диффузоры для фенов'],
  ['parts-power', 'parts', 'Акумулятори, зарядні пристрої та адаптери', 'Аккумуляторы, зарядные устройства и адаптеры'],
  ['parts-care', 'parts', 'Засоби для догляду за технікою', 'Средства для ухода за техникой'],
  ['parts-other', 'parts', 'Інші запчастини', 'Другие запчасти'],

  ['scissors', null, 'Перукарські ножиці', 'Парикмахерские ножницы'],
  ['scissors-straight', 'scissors', 'Прямі ножиці', 'Прямые ножницы'],
  ['scissors-thinning', 'scissors', 'Філірувальні ножиці', 'Филировочные ножницы'],
  ['scissors-sets', 'scissors', 'Набори ножиць', 'Наборы ножниц'],
  ['scissors-hot', 'scissors', 'Гарячі ножиці', 'Горячие ножницы'],

  ['combs', null, 'Гребінці, щітки та брашинги', 'Расчески, щетки и брашинги'],
  ['combs-combs', 'combs', 'Гребінці', 'Расчески'],
  ['combs-brushings', 'combs', 'Брашинги', 'Брашинги'],
  ['combs-brushes', 'combs', 'Щітки для волосся', 'Щетки для волос'],
  ['combs-fade', 'combs', 'Щітки для фейду та змітання волосся', 'Щетки для фейда и сметания волос'],

  ['tools', null, 'Перукарські аксесуари', 'Парикмахерские аксессуары'],
  ['tools-rollers', 'tools', 'Бігуді', 'Бигуди'],
  ['tools-clips', 'tools', 'Затискачі, шпильки та невидимки', 'Зажимы, шпильки и невидимки'],
  ['tools-sprayers', 'tools', 'Розпилювачі', 'Распылители'],
  ['tools-capes', 'tools', 'Пеньюари та пелерини', 'Пеньюары и пелерины'],
  ['tools-aprons', 'tools', 'Фартухи та одяг', 'Фартуки и одежда'],
  ['tools-collars', 'tools', 'Комірці та наплічники', 'Воротнички и наплечники'],
  ['tools-bags', 'tools', 'Сумки, кейси та чохли', 'Сумки, кейсы и чехлы'],
  ['tools-holders', 'tools', 'Підставки, килимки та органайзери', 'Подставки, коврики и органайзеры'],
  ['tools-mirrors', 'tools', 'Дзеркала', 'Зеркала'],
  ['tools-mannequins', 'tools', 'Навчальні манекени', 'Учебные манекены'],
  ['tools-coloring', 'tools', 'Аксесуари для фарбування', 'Аксессуары для окрашивания'],
  ['tools-other', 'tools', 'Інші перукарські аксесуари', 'Другие парикмахерские аксессуары'],

  ['mani', null, 'Манікюр та педикюр', 'Маникюр и педикюр'],
  ['mani-sets', 'mani', 'Манікюрні набори', 'Маникюрные наборы'],
  ['mani-scissors', 'mani', 'Манікюрні ножиці', 'Маникюрные ножницы'],
  ['mani-nippers', 'mani', 'Кусачки для манікюру', 'Кусачки для маникюра'],
  ['mani-pedinippers', 'mani', 'Кусачки для педикюру', 'Кусачки для педикюра'],
  ['mani-clippers', 'mani', 'Кніпсери', 'Книпсеры'],
  ['mani-pushers', 'mani', 'Лопатки та пушери', 'Лопатки и пушеры'],
  ['mani-files', 'mani', 'Пилки та бафи', 'Пилки и бафы'],
  ['mani-cutters', 'mani', 'Різці для кутикули', 'Резцы для кутикулы'],
  ['mani-pedi', 'mani', 'Інструменти для педикюру', 'Инструменты для педикюра'],
  ['mani-devices', 'mani', 'Фрезери та лампи для манікюру', 'Фрезеры и лампы для маникюра'],
  ['mani-other', 'mani', 'Аксесуари для манікюру', 'Аксессуары для маникюра'],

  ['shaving', null, 'Гоління', 'Бритье'],
  ['shaving-razors', 'shaving', 'Бритви та леза', 'Бритвы и лезвия'],
  ['shaving-accessories', 'shaving', 'Аксесуари для гоління', 'Аксессуары для бритья'],

  ['cosmetics', null, 'Косметика для волосся, бороди та гоління', 'Косметика для волос, бороды и бритья'],
  ['cos-styling', 'cosmetics', 'Засоби для укладання волосся', 'Средства для укладки волос'],
  ['cos-haircare', 'cosmetics', 'Догляд за волоссям', 'Уход за волосами'],
  ['cos-tint', 'cosmetics', 'Тонування волосся', 'Тонирование волос'],
  ['cos-beard', 'cosmetics', 'Догляд за бородою', 'Уход за бородой'],
  ['cos-shave', 'cosmetics', 'Засоби для гоління та після гоління', 'Средства для бритья и после бритья'],
  ['cos-face', 'cosmetics', 'Догляд за обличчям', 'Уход за лицом'],
  ['cos-perfume', 'cosmetics', 'Парфуми', 'Парфюмерия'],

  ['body', null, 'Догляд за обличчям і тілом', 'Уход за лицом и телом'],
  ['body-tweezers', 'body', 'Пінцети', 'Пинцеты'],
  ['body-makeup', 'body', 'Кисті для макіяжу', 'Кисти для макияжа'],
  ['body-sponges', 'body', 'Губки, спонжі та аплікатори', 'Губки, спонжи и аппликаторы'],
  ['body-cosmetology', 'body', 'Косметологічні інструменти', 'Косметологические инструменты'],
  ['body-bath', 'body', 'Аксесуари для ванни', 'Аксессуары для ванны'],
  ['body-depilation', 'body', 'Депіляція та воскоплави', 'Депиляция и воскоплавы'],
  ['body-devices', 'body', 'Прилади для догляду за обличчям і тілом', 'Приборы для ухода за лицом и телом'],

  ['hygiene', null, 'Дезінфекція та гігієна', 'Дезинфекция и гигиена'],
  ['hygiene-disinfection', 'hygiene', 'Засоби для дезінфекції', 'Средства для дезинфекции'],
  ['hygiene-disposable', 'hygiene', 'Одноразові та гігієнічні товари', 'Одноразовые и гигиенические товары'],

  ['grooming', null, 'Грумінг', 'Груминг'],
  ['groom-clippers', 'grooming', 'Машинки для стрижки тварин', 'Машинки для стрижки животных'],
  ['groom-trimmers', 'grooming', 'Тримери для стрижки тварин', 'Триммеры для стрижки животных'],
  ['groom-blades', 'grooming', 'Ножові блоки для тварин', 'Ножевые блоки для животных'],
  ['groom-guides', 'grooming', 'Насадки для машинок для тварин', 'Насадки для машинок для животных'],
  ['groom-tools', 'grooming', 'Гребінці, щітки та інструменти для грумінгу', 'Расчески, щетки и инструменты для груминга'],
  ['groom-cosmetics', 'grooming', 'Косметика для тварин', 'Косметика для животных'],
  ['groom-other', 'grooming', 'Аксесуари та обладнання для грумінгу', 'Аксессуары и оборудование для груминга'],

  ['salon', null, 'Обладнання для салону', 'Оборудование для салона'],
  ['salon-furniture', 'salon', 'Крісла та меблі', 'Кресла и мебель'],
  ['salon-carts', 'salon', 'Перукарські візки', 'Парикмахерские тележки'],
  ['salon-climazones', 'salon', 'Клімазони та сушуари', 'Климазоны и сушуары'],
  ['salon-devices', 'salon', 'Стерилізатори та інша техніка для салону', 'Стерилизаторы и другая техника для салона'],

  ['merch', null, 'Мерч та рекламна продукція', 'Мерч и рекламная продукция'],
];

export const CATEGORIES = TREE.map(([id, parent, ua, ru], i) => ({ id, parent, ua, ru, sort: i + 1 }));
const byId = new Map(CATEGORIES.map((c) => [c.id, c]));
export const categoryById = (id) => byId.get(id);
/** "Техніка для перукарів і барберів/Машинки для стрижки" (lang: 'ua' | 'ru'). */
export function categoryPath(id, lang = 'ua') {
  const parts = [];
  for (let c = byId.get(id); c; c = byId.get(c.parent)) parts.unshift(c[lang]);
  return parts.join('/');
}

// ---- rules --------------------------------------------------------------------------------------
// Texts are lower-case Ukrainian. Cyrillic needs (?<!\p{L}) / (?!\p{L}) instead of \b (\b is ASCII only).

/**
 * 1. The product type at the start of the name wins over the shop's category: shops put chargers in
 *    "Trimmers", capes in "Hot scissors", knives in "Shavers". [regex on the first words, id, id for
 *    animal products (or undefined = same)]
 */
const HEAD_RULES = [
  [/^(\S+ )?(набір|засіб|спрей) для догляду за (перукарськ\S* )?ножиц/, 'tools-other'],
  [/^(\S+ )?органайзер/, 'tools-holders'],
  [/^штатив/, 'tools-mannequins'],
  [/^брелок/, 'merch'],
  [/^(\S+ ){0,2}(спрей|масло|олія|засіб|набір) (для|по) (догляду за (нож|інструмент|машинк)|охолодж|змащ|ножів|машинок)/, 'parts-care'],
  [/^(\S+ ){0,2}(кейс|сумка|чохол|футляр)/, 'tools-bags'],
  [/^(\S+ ){0,2}(коврик|килимок)/, 'tools-holders'],
  [/^(\S+ ){0,2}міксер/, 'tools-coloring'],
  [/^масажер/, 'body-devices'],
  [/^пензлик для гоління|^помазок/, 'shaving-accessories'],
  [/^(\S+ )?мочалк/, 'body-bath'],
  [/^термозахист|^(\S+ )?олійк\S* для волосся/, 'cos-haircare'],
  [/^(петля|ложка|кюретк)/, 'body-cosmetology'],
  [/^шпатель/, 'body-depilation'],
  [/^(спа )?ванночк/, 'mani-other'],
  [/^(\S+ )?(батаре|акумулятор)/, 'parts-power'],
  [/^(каретк|куліск|якір|якорь|фіксатор|прокладк|коромисл|утримуюч|тримач ножа)/, 'parts-other'],
  [/^(\S+ ){0,2}насадк\S*.*(фен|браш|дифуз)/, 'parts-dryer'],
  [/^(\S+ )?(бритва-шейвер|шейвер)/, 'tech-shavers'],
  [/^(змінн\S* |запасн\S* |запаска )?(сітк|картридж)/, 'parts-shaver'],
  [/^(\S+ )?(адаптер|зарядн|акумулятор|блок живлення|док-станц|кабель|шнур)/, 'parts-power'],
  [/^(змінн\S* )?(фільтр|дифузор|концентратор)/, 'parts-dryer'],
  [/^(змінн\S* )?(ножов\S* блок|ніж |ножі )/, 'parts-blades', 'groom-blades'],
  [/^(набір |комплект )?(\S*-)?(металев\S* |змінн\S* |універсальн\S* )?насад/, 'parts-guides', 'groom-guides'],
  [/^(корпус|плата|мотор|кнопк|пружин|кришк|важіль|ексцентрик)/, 'parts-other'],
  [/^(\S+ )?пеньюар|^(\S+ )?пелерин/, 'tools-capes'],
  [/^(\S+ )?фартух|комплект одягу/, 'tools-aprons'],
  [/^(паперов\S* |силіконов\S* )?комір/, 'tools-collars'],
  [/^(\S+ )?візок/, 'salon-carts'],
  [/^(міні |комплект |шліфувальн\S* )?пил(к|оч)/, 'mani-files'],
  [/^різець/, 'mani-cutters'],
  [/^лопатк/, 'mani-pushers'],
  [/^пінцет/, 'body-tweezers'],
  [/^(\S+ )?(терк|пемз)/, 'mani-pedi'],
  [/^(\S+ )?(односторонн\S* |двосторонн\S* )?леза(?!\p{L})/u, 'shaving-razors'],
  [/^(\S+ )?бритва(?!-шейвер)/, 'shaving-razors'],
  [/^(\S+ )?(голова-манекен|манекен)/, 'tools-mannequins'],
  [/^(\S+ )?тример для нос[ауі]/, 'tech-nose'],
  [/^(побутов\S* |професійн\S* )?тример/, 'tech-trimmers', 'groom-trimmers'],
  [/^(професійн\S* )?(набір|комплект)(?!.*насад)(?!.*догляд)(?!.*ножиц).*(машинк|тример|шейвер|neo kit|\+)/, 'tech-sets'],
  [/^ножиці для кутикул|^манікюрн\S* ножиці/, 'mani-scissors'],
  [/^(\S+ )?кусачки (для педикюру|для нігтів на ногах)/, 'mani-pedinippers'],
  [/^(\S+ )?кусачки/, 'mani-nippers'],
  [/^кніпсер/, 'mani-clippers'],
  [/^(снепбек|кепк|футболк|худі|штани|кружк|стікер|шопер)/, 'merch'],
];

/** 2. Animal grooming (any shop): [regex on the name, id]; the first match wins, else groom-other. */
const GROOM_RULES = [
  [/ножов|(?<!\p{L})ніж|blade/u, 'groom-blades'],
  [/насадк|насадок/, 'groom-guides'],
  [/фен для волосся/, 'tech-dryers'],
  [/(?<!\p{L})фен/u, 'groom-other'],
  [/шампун|кондиціонер|спрей|косметик|бальзам|лосьйон/, 'groom-cosmetics'],
  [/машинк/, 'groom-clippers'],
  [/трим+ер/, 'groom-trimmers'],
  [/гребін|щітк|пуходір|слікер|кігтеріз|ножиц|колтунорі|граблі|фурмінатор/, 'groom-tools'],
  [/масло|мастил|змащен|олія|охолодж|очищ/, 'parts-care'],
];

/**
 * 3. A shop category, matched level by level from the deepest one ("…/Машинки для стрижки/BaByliss PRO"
 *    is decided by "Машинки для стрижки"). [regex on one level, regex on the name or null, id]
 *    '__parts__' sorts spare parts by what they are.
 */
const PART_RULES = [
  [/обмежувач (кабел|шнур|провод)/, 'parts-other'],
  [/акумулятор|батаре|заряд|адаптер|адаптор|блок живлення|док-станц|кабель|шнур|трансформатор/, 'parts-power'],
  [/сітк|сіточк|картридж|ріжучий блок шейвер|ніж.*(шейвер|бритв)|(шейвер|бритв).*(ніж|лез)|foil|головк/, 'parts-shaver'],
  [/дифузор|концентратор|сопло|фільтр|фен.*насад|насад.*фен/, 'parts-dryer'],
  [/масло|мастил|олі[яї]|спрей|змазк|засіб|охолодж|очищ|clean|cide(?!\p{L})/u, 'parts-care'],
  [/ножов|(?<!\p{L})ніж|ножі(?!\p{L})|ножів|лез|blade/u, 'parts-blades'],
  [/насадк|насадок|обмежувач|guide|приставк/, 'parts-guides'],
  [null, 'parts-other'],
];

const RULES = [
  // spare parts and accessories of the machines
  [/комплектуюч|запчастин|аксесуари та деталі/, '__parts__', null],
  [/^насадки$|насадки до машинок|насадки для машинок/, null, 'parts-guides'],
  [/^ножові блоки$|ножі для машинок|ножі для тримерів/, null, 'parts-blades'],
  [/ножі та сітки для шейверів/, null, 'parts-shaver'],
  [/акумулятори|адаптери живлення/, null, 'parts-power'],
  [/мотори|плати управління/, null, 'parts-other'],
  [/дифузори та насадки для фенів|аксесуари та комлектуючі до фенів|аксесуари для фенів|аксесуари для стайлерів/, null, 'parts-dryer'],
  [/засоби для догляду за машинками|догляд за інструментами|спреї для догляду за ножовими/, null, 'parts-care'],

  // technics
  [/набори для стрижки|набори техніки для стрижки/, null, 'tech-sets'],
  [/тримери? для носа|триммери для носа/, null, 'tech-nose'],
  [/машинки для стрижки|^машинки$/, null, 'tech-clippers'],
  [/тримери для стрижки|тримери для окантовки|^тримери$|триммери для стрижки/, null, 'tech-trimmers'],
  [/шейвер|електробритв/, null, 'tech-shavers'],
  [/фен-щітк|стайлер|термобраш/, null, 'tech-airstylers'],
  [/^фени( для волосся)?$|^фени /, null, 'tech-dryers'],
  [/випрямляч|утюжк/, /гофре/, 'tech-crimpers'],
  [/випрямляч/, null, 'tech-straighteners'],
  [/гофре/, null, 'tech-crimpers'],
  [/плойк/, null, 'tech-curlers'],
  [/електробігуді|термобігуді/, null, 'tech-hotrollers'],
  [/клімазон|сушуар/, null, 'salon-climazones'],
  [/^інноваційна техніка|перукарська техніка|перукарське обладнання$|інноваційна техніка для салону|стерилізатор|розпарювач|смітник/, null, 'salon-devices'],

  // manicure and pedicure (before hair scissors: "Манікюрні ножиці")
  [/манікюрн.*набор|манікюрний набір|манікюрні набори|міні-набори/, null, 'mani-sets'],
  [/манікюрні ножиці|ножиці для манікюру/, null, 'mani-scissors'],
  [/кусачки для педикюру/, null, 'mani-pedinippers'],
  [/кусачки/, null, 'mani-nippers'],
  [/кніпсер/, null, 'mani-clippers'],
  [/лопатк/, null, 'mani-pushers'],
  [/пилк|пилочк|баф/, null, 'mani-files'],
  [/різці|різець/, null, 'mani-cutters'],
  [/педикюрний інструмент|інструменти для педикюр|бритвенні інструменти/, null, 'mani-pedi'],
  [/фрезер|лампи для манікюру/, null, 'mani-devices'],
  [/ванночк|аксесуари для манікюру/, null, 'mani-other'],
  [/манікюр|педикюр/, null, null], // the general manicure sections: decided by the name

  // hair scissors
  [/гарячі ножиці/, null, 'scissors-hot'],
  [/набори ножиць|комплекти ножиць/, null, 'scissors-sets'],
  [/філіру|філіров/, null, 'scissors-thinning'],
  [/^(cумки|сумки) та чохли|футляри для перукарських ножиць|чохли для ножових/, null, 'tools-bags'],
  [/ножиці|ножиц|серія /, /філір|філіров|(?<!\p{L})тх(?!\p{L})|(?<![a-z])(th|tx)(?![a-z])|\d+\s*зуб/u, 'scissors-thinning'],
  [/ножиці|ножиц|серія /, /набір|набор|комплект/, 'scissors-sets'],
  [/ножиці|ножиц|^серія /, null, 'scissors-straight'],

  // combs and brushes
  [/щітки для фейду|щітки для змітання/, null, 'combs-fade'],
  [/брашинг/, null, 'combs-brushings'],
  [/щітк/, null, 'combs-brushes'],
  [/гребін|гребен/, null, 'combs-combs'],

  // hairdresser accessories
  [/бігуді/, null, 'tools-rollers'],
  [/затискач|зажим|невидимки|шпильки/, null, 'tools-clips'],
  [/розпилювач/, null, 'tools-sprayers'],
  [/пеньюар|пелерин/, null, 'tools-capes'],
  [/фартух|одяг/, null, 'tools-aprons'],
  [/комірц|наплічник/, null, 'tools-collars'],
  [/сумк|чохл|кейс|валіз|рюкзак|косметичк|пояси для інструментів/, null, 'tools-bags'],
  [/підставк|килим|органайзер|термокилим|коврик/, null, 'tools-holders'],
  [/візки/, /фарбуван/, 'tools-coloring'],
  [/візки/, null, 'salon-carts'],
  [/крісл/, null, 'salon-furniture'],
  [/дзеркал/, null, 'tools-mirrors'],
  [/манекен|навчальн/, null, 'tools-mannequins'],
  [/тонувальн|засоби для фарбування волосся/, null, 'cos-tint'],
  [/фарбуван|покраск|ваги для фарби/, null, 'tools-coloring'],

  // shaving
  [/^бритви$/, null, 'shaving-razors'],
  [/аксесуари для гоління/, /бритв|шаветк|лез/, 'shaving-razors'],
  [/аксесуари для гоління/, null, 'shaving-accessories'],

  // cosmetics
  [/парфум/, null, 'cos-perfume'],
  [/борода|бороди|бородою/, null, 'cos-beard'],
  [/після гоління|для гоління|косметика для гоління/, null, 'cos-shave'],
  [/засоби для догляду за обличчям|маски для догляду|скраби|тоніки для догляду за обличчям/, null, 'cos-face'],
  [/стайлінг|укладан|воски для волосся|порошкові воски|спреї для волосся|креми для волосся|помади|пудри|гелі для волосся|лаки|пасти|піна для волосся|павутинк/, null, 'cos-styling'],
  [/шампун|кондиціонер|незмивн|сироватк|тоніки для волосся|термозахист|re-form|re-blond|^маски$|^креми$|тестери/, null, 'cos-haircare'],

  // face and body
  [/пінцет/, null, 'body-tweezers'],
  [/кисті для макіяжу|^кисті/, null, 'body-makeup'],
  [/губки|спонж|аплікатор/, null, 'body-sponges'],
  [/косметологічні інструменти|інструменти для косметології/, null, 'body-cosmetology'],
  [/аксесуари для ванни/, null, 'body-bath'],
  [/депіляц|воски в гранулах|касетні воски|баночні воски/, null, 'body-depilation'],
  [/^догляд за тілом$/, null, 'body-devices'], // gamaofficial.com.ua: face/body care devices

  // disinfection and hygiene
  [/дезінфекц|дезинфек|all1clean|trimmercide|колби/, null, 'hygiene-disinfection'],
  [/гігієн|одноразов/, null, 'hygiene-disposable'],

  // brand stores' own sections
  [/постери|стенди|дошки для серфінгу/, null, 'merch'],
];

/** 4. The product name alone, for categories like "Аксесуари" or "Новинки" that say nothing. */
const NAME_RULES = [
  [/(набір|комплект).*\+/, 'tech-sets'],
  [/олійк|олія для волосся|термозахист/, 'cos-haircare'],
  [/кітель|сорочк|комплект одягу/, 'tools-aprons'],
  [/наплічник/, 'tools-collars'],
  [/фрезер/, 'mani-devices'],
  [/плата|мотор|корпус|кнопк|пружин|важіл|кришк|перемикач|шестерн|запчастин/, 'parts-other'],
  [/воскоплав|розігріву воску|парафін|воск для депіляц/, 'body-depilation'],
  [/пилосос|смітник|стерилізатор|розпарювач|ультрафіолет/, 'salon-devices'],
  [/крісл|стілець|пуф(?!\p{L})/u, 'salon-furniture'],
  [/макіяж|пензл|кисть/, 'body-makeup'],
  [/для догляду за обличчям|прилад для догляду|масажер|епілятор/, 'body-devices'],
  [/догляду за ножиц|амортизатор|упор для пальц|кільц[еяі] для ножиц|гвинт/, 'tools-other'],
  [/догляду за нож(ами|овими)|догляду за машинк/, 'parts-care'],
  [/шапочк|рушник|полотенц|рукавичк|пакет|серветк/, 'hygiene-disposable'],
  [/машинка для стрижки|машинк/, 'tech-clippers'],
  [/тример/, 'tech-trimmers'],
  [/шейвер|електробритв/, 'tech-shavers'],
  [/фен-щітк|стайлер/, 'tech-airstylers'],
  [/(?<!\p{L})фен(?!\p{L})/u, 'tech-dryers'],
  [/випрямляч|праска/, 'tech-straighteners'],
  [/плойк/, 'tech-curlers'],
  [/гофре/, 'tech-crimpers'],
  [/ножиці/, 'scissors-straight'],
  [/брашинг/, 'combs-brushings'],
  [/щітк/, 'combs-brushes'],
  [/гребін/, 'combs-combs'],
  [/пеньюар|пелерин|накидк/, 'tools-capes'],
  [/фартух/, 'tools-aprons'],
  [/футболк|худі|штани|кепк|шопер|снепбек|кружк|стікер|наліпк|постер|банер|стенд|брелок|дошка для серф/, 'merch'],
  [/сумк|кейс|чохол|чохл|рюкзак|валіз|футляр/, 'tools-bags'],
  [/килимок|підставк|тримач|органайзер|магнітн/, 'tools-holders'],
  [/розпилювач|пульверизатор/, 'tools-sprayers'],
  [/затискач|зажим|кліп/, 'tools-clips'],
  [/комір/, 'tools-collars'],
  [/дзеркал/, 'tools-mirrors'],
  [/бритв|леза/, 'shaving-razors'],
  [/помазок|пензлик для гоління|чаш(а|ка) для гоління/, 'shaving-accessories'],
  [/(?<!\p{L})віск|помад|пудр|паличк|гель|лак для|спрей для|паст[аи](?!\p{L})/u, 'cos-styling'],
  [/шампун|кондиціонер|маск/, 'cos-haircare'],
  [/одеколон|лосьйон|бальзам після/, 'cos-shave'],
  [/парфум/, 'cos-perfume'],
  [/олія|масло для бороди/, 'cos-beard'],
  [/дезінфек|антисепт/, 'hygiene-disinfection'],
  [/масло|мастил|змазк/, 'parts-care'],
  [/насадк|насадок/, 'parts-guides'],
  [/ніж|ножов/, 'parts-blades'],
  [/акумулятор|зарядн|адаптер/, 'parts-power'],
  [/пилк/, 'mani-files'],
  [/набір для фарбування|фарбуван/, 'tools-coloring'],
];

const LATIN_LOOKALIKE = { a: 'а', c: 'с', e: 'е', i: 'і', o: 'о', p: 'р', x: 'х', y: 'у' };
const lower = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Latin look-alike letters inside Cyrillic words ("Наcадка" with a Latin c) -> Cyrillic
    .replace(/(?<=\p{Script=Cyrillic})[aceiopxy]|[aceiopxy](?=\p{Script=Cyrillic})/gu, (c) => LATIN_LOOKALIKE[c]);

const ANIMAL = /тварин|грумін|грумер|animal|для собак|для кішок|для котів/;
/** Shops that only sell animal grooming products. */
const ANIMAL_SHOPS = new Set(['moser']);

/**
 * What a product IS is said before "до", "для", "на"…: "Перемикач … до фену" is a part, "Фен для
 * волосся" is a dryer, "Брелок у вигляді машинки" is a souvenir. The words before the first of them.
 */
const PREPOSITION = /\s(до|для|на|від|під|у вигляді|в вигляді)\s/;
const typeWords = (nm) => {
  const m = PREPOSITION.exec(nm);
  return m ? nm.slice(0, m.index) : nm;
};
/** the word a device's own name has (a dryer's name says "фен" before any "до"/"для") */
const DEVICE = {
  'tech-clippers': /машинк/,
  'tech-trimmers': /трим+ер/,
  'tech-nose': /трим+ер/,
  'tech-shavers': /шейвер|бритв/,
  'tech-sets': /набір|набор|комплект|машинк|трим+ер/,
  'tech-dryers': /(?<!\p{L})фен/u,
  'tech-airstylers': /стайлер|фен|браш/,
  'tech-straighteners': /випрямляч|праск|утюжк/,
  'tech-curlers': /плойк|стайлер|щипц/,
  'tech-crimpers': /гофре|плойк|щипц|випрямляч/,
  'tech-hotrollers': /бігуді/,
};
/** words of parts and accessories of a device */
const PART_WORDS = /накладк|рамк|корпус|гільз|перемикач|кнопк|обмежувач|кронштейн|брелок|сувенір|резинк|підставк|тримач|кришк|регулювання ножів|ремкомплект|запчастин|шестерн|двигун|мотор|плат[аи](?!\p{L})|нагріва\S* елемент|база для зарядк|адаптор|адаптер/u;
/** A part or accessory OF a device (not the device): where it goes. */
function partOf(nm) {
  if (/брелок|сувенір/.test(nm)) return 'merch';
  if (/(?<!\p{L})(підставк|тримач настін|настінн\S* тримач|тримач для|тримач до)/u.test(nm) && !/заряд/.test(nm)) return 'tools-holders';
  for (const [partRe, partId] of PART_RULES) if (!partRe || partRe.test(nm)) return partId;
  return 'parts-other';
}
/** a technics category for something that is only a part of it -> the part's category */
function checkDevice(id, nm) {
  if (!id || !DEVICE[id]) return id;
  const head = typeWords(nm);
  if (DEVICE[id].test(head) && !PART_WORDS.test(head)) return id; // "Фен для волосся …"
  if (!DEVICE[id].test(nm) && !PART_WORDS.test(head)) return id; // a name of a model only ("JRL Onyx")
  return partOf(nm);
}

/** Category id for one offer: its shop, Ukrainian category path and name; null if no rule matches. */
export function classify(source, categoryPath, name) {
  const cat = lower(categoryPath);
  const nm = lower(name).trim();
  const animal = ANIMAL_SHOPS.has(source) || ANIMAL.test(cat) || ANIMAL.test(nm);

  // 1. the type at the start of the name
  const head = nm.split(/\s+/).slice(0, 5).join(' ');
  for (const [re, id, animalId] of HEAD_RULES) {
    if (re.test(head)) return (animal && animalId) || id;
  }
  // 2. animal grooming
  if (animal) {
    for (const [re, id] of GROOM_RULES) if (re.test(nm)) return id;
    return 'groom-other';
  }
  // 3. the shop's category, deepest level first
  const levels = cat.split('/').filter(Boolean).reverse();
  for (const level of levels) {
    for (const [catRe, nameRe, id] of RULES) {
      if (!catRe.test(level)) continue;
      if (nameRe === '__parts__') {
        for (const [partRe, partId] of PART_RULES) if (!partRe || partRe.test(nm)) return partId;
      }
      if (nameRe && !nameRe.test(nm)) continue;
      if (id) return checkDevice(id, nm);
      break; // a section that says nothing: try the name rules
    }
  }
  // 4. the name alone: what it is (the words before "до", "для"…) first, then the whole name
  const head4 = typeWords(nm);
  if (head4 !== nm) for (const [re, id] of NAME_RULES) if (re.test(head4)) return checkDevice(id, nm);
  for (const [re, id] of NAME_RULES) if (re.test(nm)) return checkDevice(id, nm);
  if (PART_WORDS.test(head4)) return partOf(nm); // "Обмежувач кабелю до фену …"
  if (/аксесуар/.test(cat)) return 'tools-other';
  if (/манікюр|педикюр/.test(cat)) return 'mani-other';
  return null;
}
