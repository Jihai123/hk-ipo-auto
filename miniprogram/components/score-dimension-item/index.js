Component({
  properties: {
    item: {
      type: Object,
      value: {},
    },
  },
  data: {
    expanded: false,
  },
  methods: {
    toggle() {
      this.setData({ expanded: !this.data.expanded });
    },
  },
});
