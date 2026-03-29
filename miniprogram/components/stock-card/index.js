Component({
  properties: {
    code: String,
    name: String,
    extra: String,
    score: Number,
  },
  methods: {
    onTap() {
      this.triggerEvent('tapitem', {
        code: this.data.code,
      });
    },
  },
});
