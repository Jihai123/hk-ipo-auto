Component({
  properties: {
    item: {
      type: Object,
      value: {},
    },
    statusLabel: {
      type: String,
      value: '',
    },
  },
  methods: {
    onTap() {
      this.triggerEvent('tapitem', {
        code: this.data.item?.code,
      });
    },
  },
});
