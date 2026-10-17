/* levels_coop.js — 双人合作关卡包：纯数据文件，不依赖游戏任何代码；浏览器(<script>)和 Node(require)都能直接加载，
   游戏(coop.js / lobby.js 抽关)、求解器(coop_solver.js)、以后的地图编辑小工具都读同一份，编辑器导出的就是这个格式。
   格式：COOP_LEVEL_PACK = { levels:[{ id, xsb }] }；id 只能是字母数字下划线横线(≤24，大厅/网络里当关卡编号传)。
   xsb 按「横屏」画(宽 ≥ 高)，竖屏设备显示时由 coop.js 转置；字符：
     # 墙  空格 地板  . 目标  $ 箱子  * 目标上的箱子  @ 1 号(房主)  + 1 号在目标上  & 2 号(玩家)  % 2 号在目标上
   校验/解析/转置用 coop_rules.js 的 COOP_RULES.check / fromXsb / toXsb；跑 `node coop_solver.js` 看连通、双人最少步数、是否「只有一个人动就解不开」。
   目前只有 3 张测试图，用来真机测两台设备的同步观感，不是正式地图：
   - CO-01 空旷场地：两人容易互相挡路、同时推箱，专门测「抢格子」和同步观感。
   - CO-02 / CO-03 随机生成再用求解器筛过：单人(另一人原地不动)解不开、双人能解；好不好玩未验证，别当正式关。 */
(function (root) {
'use strict';
const PACK = {
  levels: [
    { id: 'CO-01', xsb: [
      '#########',
      '#@  $  .#',
      '#   $  .#',
      '#&      #',
      '#########' ].join('\n') },
    { id: 'CO-02', xsb: [
      '########',
      '#    #.#',
      '#     @#',
      '# $$&  #',
      '#   # .#',
      '########' ].join('\n') },
    { id: 'CO-03', xsb: [
      '########',
      '##  #. #',
      '#  .   #',
      '# #$ $ #',
      '#&@  # #',
      '########' ].join('\n') },
  ],
};
root.COOP_LEVEL_PACK = PACK;
if (typeof module !== 'undefined' && module.exports) module.exports = PACK;
})(typeof window !== 'undefined' ? window : globalThis);
