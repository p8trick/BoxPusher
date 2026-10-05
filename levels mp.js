/* levels_mp.js — 多人竞速关卡包（仅测试用：每档一关，已用求解器验证可解）
 * 格式：window.MP_LEVEL_PACK = { version, tiers: [ { key, name:{zh,en}, levels:[ { id, xsb, par } ] } ] }
 * xsb 为标准 XSB（# 墙  空格 地板  @ 人  + 人在目标上  $ 箱  * 箱在目标上  . 目标），每行等宽。
 * par = 人物最少总步数（求解器算出的真最小值，和 levels.js 的 par 同义）。
 * 竞速开局：房主在所选 tier 的 levels 里随机抽一关。正式关卡以后替换本文件内容即可，格式不变。
 */
window.MP_LEVEL_PACK = {
  version: 1,
  tiers: [
    {
      key: 'easy',
      name: { zh: '竞速入门', en: 'Race: Easy' },
      levels: [
        {
          id: 'MPE-T1',
          par: 14,
          xsb: [
            '########',
            '#      #',
            '# $  . #',
            '#  @   #',
            '# $  . #',
            '#      #',
            '########'
          ].join('\n')
        }
      ]
    },
    {
      key: 'normal',
      name: { zh: '竞速正常', en: 'Race: Normal' },
      levels: [
        {
          id: 'MPN-T1',
          par: 42,
          xsb: [
            '#########',
            '#       #',
            '# $ #   #',
            '#   # . #',
            '# $   $ #',
            '#   # . #',
            '# @ #   #',
            '#     . #',
            '#########'
          ].join('\n')
        }
      ]
    }
  ]
};
