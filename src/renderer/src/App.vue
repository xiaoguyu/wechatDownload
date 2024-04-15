<script setup lang="ts">
import { ref } from 'vue';
import Home from './views/Home.vue';
import Setting from './views/Setting.vue';
import EpubCreator from './views/EpubCreator.vue';
//中文包
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';

const menuIdx = ref('1');
function changeMenuIdx(index) {
  menuIdx.value = index;
}
</script>

<template>
  <el-config-provider :locale="zhCn">
    <el-menu mode="horizontal" background-color="#545c64" text-color="#fff" active-text-color="#ffd04b" class="my-menu" :default-active="menuIdx" @select="changeMenuIdx">
      <el-menu-item index="1">主页面</el-menu-item>
      <el-menu-item index="2">设置中心</el-menu-item>
      <el-menu-item index="3">生成Epub</el-menu-item>
    </el-menu>
    <div class="home-div">
      <keep-alive>
        <Home v-if="menuIdx === '1'" />
      </keep-alive>
      <keep-alive>
        <Setting v-if="menuIdx === '2'" />
      </keep-alive>
      <keep-alive>
        <EpubCreator v-if="menuIdx === '3'" />
      </keep-alive>
    </div>
  </el-config-provider>
</template>
<style scoped>
.my-menu {
  height: 35px;
  position: fixed;
  top: 0;
  right: 0;
  left: 0;
  z-index: 999;
}

.home-div {
  height: 100%;
}
</style>
