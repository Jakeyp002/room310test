# Room310 · Your first neuron
# Original teaching examples. Run top to bottom.

# A model is a calculation with adjustable numbers
x = 3.0
weight = 2.0
bias = 1.0

prediction = weight * x + bias
print("Prediction:", prediction)

# More inputs, one output
inputs = [2.0, -1.0]
weights = [0.5, 1.0]
bias = 0.25

score = sum(x * w for x, w in zip(inputs, weights)) + bias
activated = max(0.0, score)  # ReLU
print("Before activation:", score)
print("After ReLU:", activated)
