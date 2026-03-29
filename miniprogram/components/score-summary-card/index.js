Component({
  properties: {
    name: String,
    code: String,
    totalScore: Number,
    ratingLabel: String,
    conclusion: String,
    tone: {
      type: String,
      value: 'neutral',
    },
  },
});
