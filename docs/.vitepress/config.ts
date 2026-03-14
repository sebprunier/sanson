import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Sanson',
  description: 'An open source geospatial server — OGC API Features compliant',
  base: '/sanson/',

  head: [['link', { rel: 'icon', href: '/sanson/logo.png' }]],

  ignoreDeadLinks: [/^https?:\/\/localhost/],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Sanson',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API Reference', link: '/api/ogc-endpoints' },
      { text: 'Admin UI', link: '/admin-ui/overview' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Configuration', link: '/guide/configuration' },
            { text: 'Data Import', link: '/guide/data-import' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'OGC Endpoints', link: '/api/ogc-endpoints' },
            { text: 'Admin Endpoints', link: '/api/admin-endpoints' },
            { text: 'CQL2 Filtering', link: '/api/cql2-filtering' },
            { text: 'Spatial Filtering', link: '/api/spatial-filtering' },
            { text: 'Vector Tiles', link: '/api/vector-tiles' },
          ],
        },
      ],
      '/admin-ui/': [
        {
          text: 'Admin UI',
          items: [{ text: 'Overview', link: '/admin-ui/overview' }],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/sebprunier/sanson' }],

    editLink: {
      pattern: 'https://github.com/sebprunier/sanson/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT License.',
    },

    search: {
      provider: 'local',
    },
  },
})
