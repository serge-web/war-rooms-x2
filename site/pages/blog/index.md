<script setup lang="ts">
import { withBase } from 'vitepress'
import { data as posts } from './posts.data.ts'
</script>

# Blog

Posts on notable features and design decisions, and one at each phase gate. Posts marked _work in progress_ describe work that hasn't yet passed its phase gate.

<ul class="wrx-posts">
  <li v-for="post of posts" :key="post.url">
    <a :href="withBase(post.url)">{{ post.title }}</a>
    <span> · {{ post.date }} · Phase {{ post.phase }}</span>
    <em v-if="post.status === 'work-in-progress'"> · work in progress</em>
  </li>
</ul>
