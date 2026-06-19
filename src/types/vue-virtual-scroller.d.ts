declare module 'vue-virtual-scroller' {
  import type { DefineComponent } from 'vue';

  export const DynamicScroller: DefineComponent<any, any, any>;
  export const DynamicScrollerItem: DefineComponent<any, any, any>;
  export const RecycleScroller: DefineComponent<any, any, any>;
}

declare module 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
