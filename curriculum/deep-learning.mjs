// Original Room310 teaching material. One source feeds the website, scripts, and notebooks.
export const sources = {
  inspiration: ["Andrej Karpathy · Neural Networks: Zero to Hero", "https://karpathy.ai/zero-to-hero.html"],
  setup: ["PyTorch · installation guide", "https://pytorch.org/get-started/locally/"],
  tensors: ["PyTorch · tensors", "https://docs.pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html"],
  gradients: ["PyTorch · automatic differentiation", "https://docs.pytorch.org/tutorials/beginner/basics/autogradqs_tutorial.html"],
  optimization: ["PyTorch · optimizing model parameters", "https://docs.pytorch.org/tutorials/beginner/basics/optimization_tutorial.html"],
  networks: ["PyTorch · building a neural network", "https://docs.pytorch.org/tutorials/beginner/basics/buildmodel_tutorial.html"],
  saving: ["PyTorch · saving and loading models", "https://docs.pytorch.org/tutorials/beginner/basics/saveloadrun_tutorial.html"]
};

export const lessons = [
  {
    slug: "deep-learning-1-your-first-neuron", title: "Your first neuron", time: "25–35 min", runtime: "browser",
    description: "Turn a few Python numbers into a prediction. Understand inputs, weights, bias, and activation before importing a framework.",
    goal: "Explain every part of a neuron and change its prediction by changing its parameters.",
    sections: [
      {
        title: "A model is a calculation with adjustable numbers",
        text: "You already know how to write rules in Python. Machine learning adds a different way to choose some of the numbers in those rules: learn them from examples. A model takes an **input**, calculates a **prediction**, and later compares it with a known **target**. It does not understand a task the way a person does.\n\nStart with one input and two adjustable numbers. A **weight** controls how much the input matters. A **bias** shifts the result even when the input is zero. We call these adjustable numbers **parameters**. For now, we choose them ourselves: `prediction = weight * x + bias`.",
        code: `x = 3.0
weight = 2.0
bias = 1.0

prediction = weight * x + bias
print("Prediction:", prediction)`,
        check: "You should see 7.0. Before editing, predict what happens if weight becomes 3.0. Then run the cell: the new result should be 10.0."
      },
      {
        title: "More inputs, one output",
        text: "A neuron can combine several inputs. Each input gets its own weight; the neuron adds those weighted inputs and a bias. Here the two inputs are just invented measurements, not real-world evidence.\n\nAn **activation** changes the combined value before passing it onward. ReLU is one simple choice: keep positive values and replace negative ones with zero. Later, nonlinear activations let several layers represent patterns that a single straight line cannot.",
        code: `inputs = [2.0, -1.0]
weights = [0.5, 1.0]
bias = 0.25

score = sum(x * w for x, w in zip(inputs, weights)) + bias
activated = max(0.0, score)  # ReLU
print("Before activation:", score)
print("After ReLU:", activated)`,
        check: "Both values start at 0.25. Set bias to -0.5: the score becomes -0.5, but ReLU returns 0.0."
      },
      {
        title: "What makes a network?",
        text: "A **layer** is a group of neurons. A **neural network** connects layers so one layer's outputs become the next layer's inputs. A **hidden layer** sits between the original inputs and the final output.\n\nOur goal is deliberately small: two inputs → eight hidden neurons → one output. It is a first step into deep learning, not a large language model. Before adding those neurons, we need a way to measure mistakes and improve the parameters."
      }
    ],
    assignments: [
      {title: "Write your own neuron", task: "Write a function neuron(x, weight, bias) that returns weight * x + bias. Check neuron(4, 2, 1) == 9 and neuron(0, 2, 1) == 1. Explain why the second result depends only on the bias.", hint: "Return the calculation; printing inside the function is not enough if another calculation needs the result."},
      {title: "Predict, then run", task: "Use the two-input example with inputs [1.0, 3.0], weights [2.0, -1.0], and bias 0.0. Write down the score and ReLU result before running it.", hint: "The weighted sum is 2 - 3. ReLU clips a negative score to zero."}
    ],
    takeaway: "A neuron combines inputs using weights and a bias, then may apply an activation. Learning will adjust those parameters.",
    references: ["inspiration"]
  },
  {
    slug: "deep-learning-2-loss-and-learning", title: "How a model learns", time: "35–45 min", runtime: "browser",
    description: "Measure a mistake, estimate a slope, and train a one-neuron model using only Python.",
    goal: "Train weight and bias yourself, so PyTorch's training loop will not feel like a magic spell.",
    sections: [
      {
        title: "Give a mistake a number",
        text: "A **loss function** measures how far predictions are from targets. For a numerical prediction, one useful loss is squared error: `(prediction - target) ** 2`. Squaring makes the error nonnegative and penalizes large misses more strongly.\n\nFor several examples, we average those squared errors. This is **mean squared error**, or MSE. A lower loss is better on the examples being measured; it does not automatically mean the model will work on new examples.",
        code: `prediction = 4.0
target = 7.0
loss = (prediction - target) ** 2
print("Squared error:", loss)`,
        check: "The loss is 9.0, not -3.0. Try prediction = 6.0 and then 8.0. Both are one unit away and have loss 1.0."
      },
      {
        title: "Find which direction is downhill",
        text: "A **derivative** is a local slope: how much a result changes when one input changes a little. A **gradient** collects these slopes for the parameters. You do not need a calculus course to try a slope numerically: make a tiny nudge, measure the change in loss, and divide by the size of the nudge.\n\nA positive slope says increasing the parameter raises the loss locally. To head downhill, move in the opposite direction. The **learning rate** controls the size of that move. Too large can overshoot; too small can take a long time.",
        code: `def loss_at(weight):
    prediction = weight * 3.0 + 1.0
    return (prediction - 7.0) ** 2

weight = 0.0
epsilon = 0.0001
slope = (loss_at(weight + epsilon) - loss_at(weight - epsilon)) / (2 * epsilon)
new_weight = weight - 0.05 * slope
print("Slope:", round(slope, 3))
print("Loss before:", loss_at(weight))
print("Loss after:", round(loss_at(new_weight), 3))`,
        check: "The slope is approximately -36.0. The weight increases to about 1.8 and the loss falls from 36.0 to about 0.36."
      },
      {
        title: "Repeat the update: a training loop",
        text: "Here the invented data follows `target = 2 * x + 1`. We know that rule, but the training calculation only receives input/target pairs.\n\nFor one example, let `error = weight * x + bias - target`. Its squared-error slope with respect to weight is `2 * error * x`; with respect to bias it is `2 * error`. Average each slope across the examples, then update both parameters. This is the **chain rule** in action: a change in weight changes the prediction, which changes the loss.\n\nOne **epoch** is one pass over the training examples. This tiny course uses the whole dataset as one batch, so one epoch is also one update. Larger datasets usually take several batch updates per epoch.",
        code: `xs = [-2.0, -1.0, 0.0, 1.0, 2.0]
targets = [2 * x + 1 for x in xs]
weight, bias = 0.0, 0.0
learning_rate = 0.1

for epoch in range(60):
    errors = [weight * x + bias - y for x, y in zip(xs, targets)]
    loss = sum(error ** 2 for error in errors) / len(xs)
    grad_weight = sum(2 * error * x for error, x in zip(errors, xs)) / len(xs)
    grad_bias = sum(2 * error for error in errors) / len(xs)
    weight -= learning_rate * grad_weight
    bias -= learning_rate * grad_bias
    if epoch % 20 == 0:
        print(f"Epoch {epoch:2d} | loss before update: {loss:.6f}")

print(f"Learned weight: {weight:.3f}, bias: {bias:.3f}")
print(f"Prediction for x=3: {weight * 3 + bias:.3f}")`,
        check: "Weight should approach 2.000, bias 1.000, and the prediction for 3 should approach 7.000. This result is for our simple invented line, not proof of real-world accuracy."
      }
    ],
    assignments: [
      {title: "Learn a different line", task: "Change the targets to -3 * x + 0.5. Train again from weight = bias = 0. Print the learned parameters and a prediction for x = 1. Your prediction should be close to -2.5.", hint: "Change the data rule, not the gradient formulas. The formulas work for either line."},
      {title: "Keep an experiment log", task: "Compare learning rates 0.01, 0.1, and 0.8 for the original data. Reset the parameters for each run. Record the final loss and explain which rate learns slowly and which is unstable.", hint: "An increasing loss is a useful observation, not a reason to hide the result. Move in smaller steps if updates overshoot."}
    ],
    takeaway: "Training repeats prediction, loss, gradients, and a small parameter update. PyTorch will calculate the gradients for us.",
    references: ["gradients", "optimization"]
  },
  {
    slug: "deep-learning-3-pytorch-and-tensors", title: "Meet PyTorch & tensors", time: "30–40 min", runtime: "pytorch",
    description: "Set up a real PyTorch notebook and learn to read tensor shapes without guessing.",
    goal: "Run real PyTorch on a CPU and represent examples, features, weights, and targets as tensors.",
    sections: [
      {
        title: "Start with a real Python environment",
        text: "Use **Open in Colab** above for the ready-to-run notebook. Sign in if prompted, connect to a runtime, and run the code cells from top to bottom with Shift + Enter. The default CPU is enough; no paid GPU or API key is needed for these examples. Colab availability and usage limits are controlled by Google. Save a copy to keep your changes.\n\nPrefer your own computer? Follow the linked PyTorch installation guide for your operating system, using a virtual environment and the CPU option where offered. Download this lesson's Python file and run it with that environment's Python. In an existing notebook where `import torch` fails, run `%pip install torch` in a separate code cell, restart the kernel if asked, and run the lesson again.\n\nRoom310's standard Python cells do not include PyTorch. Do not paste these examples into the ordinary assignment runner. The complete lesson notebook includes all previous steps; it does not depend on another lesson's kernel state.",
        code: `import torch

torch.manual_seed(7)
print("PyTorch:", torch.__version__)
print("A tensor on:", torch.tensor([1.0]).device)`,
        check: "You should see a PyTorch version and cpu. A ModuleNotFoundError means PyTorch is not installed in the environment running this cell."
      },
      {
        title: "A tensor is an array with a shape",
        text: "A **tensor** stores numbers with a shape. A scalar has no axes; a vector has one; a matrix has two. For our course, rows represent examples and columns represent features.\n\nHere we have three examples, each with two features, so `X.shape` is `[3, 2]`. The single target for each example is stored as `[3, 1]`. Keep the column dimension: mixing predictions of shape `[3, 1]` with targets of shape `[3]` can accidentally broadcast into a `[3, 3]` calculation.\n\nUse floating-point tensors for these inputs and targets. Not every task uses float targets—multiclass classification with CrossEntropyLoss usually uses integer class indices—but our binary examples will use floats.",
        code: `X = torch.tensor([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
y = torch.tensor([[0.0], [1.0], [1.0]])

print("Input shape:", X.shape)
print("Target shape:", y.shape)
print("Input dtype:", X.dtype)
print("First example:", X[0])`,
        check: "Read the shapes aloud: three examples, two features; three examples, one target each. The input dtype should be torch.float32."
      },
      {
        title: "Run the same neuron on a whole batch",
        text: "The `@` operator is matrix multiplication, not element-by-element multiplication. `[3, 2] @ [2, 1]` produces `[3, 1]`: three predictions. The inner dimensions must match. This calculation replaces a Python loop over neurons and examples.\n\nThe scalar bias is **broadcast** across the three predictions. Broadcasting is convenient when intentional, but always inspect your shapes before relying on it.",
        code: `weights = torch.tensor([[0.5], [1.0]])
bias = torch.tensor(0.25)
predictions = X @ weights + bias

print("Predictions:", predictions)
assert predictions.shape == y.shape
print("One prediction per target:", predictions.shape)`,
        check: "The predictions are 2.75, 5.75, and 8.75 in a column. The shape assertion should pass. These hand-picked weights are not trained yet."
      }
    ],
    assignments: [
      {title: "Add an example", task: "Add [7.0, 8.0] to X and one target row to y. Rerun the batch calculation. Write down each shape and the new prediction before checking it.", hint: "The weights stay [2, 1] because the number of features has not changed. The new prediction is 11.75."},
      {title: "Catch a shape bug", task: "Make bad_targets = torch.tensor([0.0, 1.0, 1.0]) for the original three examples. Compare its shape with y.shape. Explain why assert predictions.shape == bad_targets.shape should fail.", hint: "A length-three vector and a three-row column matrix are different shapes. Use bad_targets.reshape(-1, 1) to make a column."}
    ],
    takeaway: "Shapes are part of your program's meaning. Check examples, features, and target dimensions before training.",
    references: ["setup", "tensors"]
  },
  {
    slug: "deep-learning-4-autograd-and-training", title: "Let PyTorch find the gradients", time: "35–45 min", runtime: "pytorch",
    description: "Connect the hand-written update to autograd, backward(), and a complete training loop.",
    goal: "Rebuild the line learner with PyTorch and explain why gradient clearing and no_grad matter.",
    sections: [
      {
        title: "Autograd records the calculation",
        text: "**Autograd** is PyTorch's automatic differentiation system. Mark a parameter with `requires_grad=True`, then calculate a loss using it. PyTorch records how those operations depend on the parameter. Calling `loss.backward()` works backward through that calculation and stores derivatives in `.grad`.\n\nThis is **backpropagation**: applying the chain rule backward through a computation graph. It calculates gradients; it does not update parameters by itself.",
        code: `import torch

weight = torch.tensor(0.0, requires_grad=True)
bias = torch.tensor(1.0, requires_grad=True)
prediction = weight * 3.0 + bias
loss = (prediction - 7.0) ** 2
loss.backward()

print("Weight gradient:", weight.grad.item())
print("Bias gradient:", bias.grad.item())`,
        check: "The weight gradient is -36.0 and the bias gradient is -12.0. The weight gradient matches our numerical slope from lesson 2."
      },
      {
        title: "Predict → measure → backpropagate → update",
        text: "Now train on the same five input/target pairs. We explicitly start new parameters at zero, so this cell does not reuse the previous example's gradients.\n\nPyTorch **accumulates gradients** by default. Clear them before each fresh backward pass. Use `torch.no_grad()` during the manual update so changing a parameter is not recorded as part of the next prediction graph. `.item()` turns a one-element tensor into a Python number for printing.\n\nEvery iteration builds a fresh forward calculation. You normally do not call backward twice on the same loss object; calculate a new loss on the next iteration.",
        code: `X = torch.tensor([[-2.0], [-1.0], [0.0], [1.0], [2.0]])
y = 2 * X + 1
weight = torch.tensor(0.0, requires_grad=True)
bias = torch.tensor(0.0, requires_grad=True)
learning_rate = 0.1

for epoch in range(60):
    weight.grad = None
    bias.grad = None
    predictions = weight * X + bias
    assert predictions.shape == y.shape
    loss = ((predictions - y) ** 2).mean()
    loss.backward()
    with torch.no_grad():
        weight -= learning_rate * weight.grad
        bias -= learning_rate * bias.grad
    if epoch % 20 == 0:
        print(f"Epoch {epoch:2d} | loss before update: {loss.item():.6f}")

print(f"Learned weight: {weight.item():.3f}, bias: {bias.item():.3f}")`,
        check: "The parameters should again approach weight 2.000 and bias 1.000. Compare this loop with lesson 2: PyTorch replaced the derivative formulas, not the learning process."
      },
      {
        title: "Use the model without training it",
        text: "**Inference** means using learned parameters to make predictions. We do not need to record gradients while doing that. `torch.no_grad()` reduces unnecessary tracking; it does not erase the learned numbers.\n\nIn the next lesson, an optimizer will handle the update and a neural-network module will hold the parameters. Keep this manual version nearby as a map of what those tools do.",
        code: `with torch.no_grad():
    new_inputs = torch.tensor([[3.0], [4.0]])
    new_predictions = weight * new_inputs + bias
print("New predictions:", new_predictions.flatten().tolist())`,
        check: "Expect values close to 7 and 9. Extrapolation works here because we invented a perfect line; real datasets need more careful evaluation."
      }
    ],
    assignments: [
      {title: "Explain four lines", task: "In your own words, explain grad = None, loss.backward(), torch.no_grad(), and weight -= learning_rate * weight.grad. Identify which line computes a gradient and which changes a parameter.", hint: "backward computes; subtraction updates. The other two control gradient bookkeeping."},
      {title: "Prove gradients accumulate", task: "In a new cell create p = torch.tensor(2.0, requires_grad=True). Run (p ** 2).backward() twice, printing p.grad after each call. Reset p.grad to None and try once more. Explain 4, 8, and 4.", hint: "Each (p ** 2) expression creates a fresh graph. Without clearing, the newly computed derivative is added to the old gradient."}
    ],
    takeaway: "Autograd calculates gradients. Your training loop still decides when to clear them, how to update parameters, and when to stop.",
    references: ["gradients", "optimization"]
  },
  {
    slug: "deep-learning-5-build-a-small-network", title: "Build your first neural network", time: "45–60 min", runtime: "pytorch",
    description: "Train a tiny two-input network on XOR and see why a hidden layer and activation matter.",
    goal: "Build and train a 2 → 8 → 1 network, then inspect all four of its binary predictions.",
    sections: [
      {
        title: "The XOR puzzle",
        text: "**XOR** means exclusive or: output 1 when two bits differ, otherwise 0. Its four examples are (0,0) → 0, (0,1) → 1, (1,0) → 1, and (1,1) → 0.\n\nImagine those inputs as the corners of a square. The positive examples sit on opposite corners. No single straight line separates them from the other two corners. A linear model with one output and a threshold cannot solve this pattern.\n\nThis is a tiny learning exercise, not a generalization benchmark: we train on all four possible binary inputs. Lesson 6 will measure predictions on genuinely held-out examples.",
        code: `import torch
from torch import nn

torch.manual_seed(7)
X = torch.tensor([[0.0, 0.0], [0.0, 1.0], [1.0, 0.0], [1.0, 1.0]])
y = torch.tensor([[0.0], [1.0], [1.0], [0.0]])
print("Inputs:", X.shape, "Targets:", y.shape)`,
        check: "There are four examples with two features each and one binary target per example."
      },
      {
        title: "Two layers and a bend in the middle",
        text: "`nn.Sequential` passes values through its layers in order. `nn.Linear(2, 8)` makes eight weighted combinations of two inputs, each with its own bias. `nn.Tanh()` bends those values into the range -1 to 1. `nn.Linear(8, 1)` combines the hidden values into one final score.\n\nWithout a nonlinear activation between them, stacking these linear layers would still be one linear calculation. The nonlinear hidden layer is what allows a more flexible boundary.\n\nThe output is a **logit**, an unrestricted score—not a probability yet. `BCEWithLogitsLoss` combines a sigmoid transformation with binary cross-entropy in a numerically stable calculation. Do **not** add a sigmoid before this loss. For this loss, the targets are floating-point 0s and 1s with the same shape as the logits.\n\nAn **optimizer** updates the parameters. Here we use Adam with a learning rate of 0.03. It adjusts update sizes using gradient history; it still depends on gradients from backward().",
        code: `model = nn.Sequential(
    nn.Linear(2, 8),
    nn.Tanh(),
    nn.Linear(8, 1),
)
loss_fn = nn.BCEWithLogitsLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=0.03)

print(model)
print("Trainable parameters:", sum(p.numel() for p in model.parameters()))`,
        check: "There are 33 parameters: 2×8 weights + 8 biases in the first layer, then 8×1 weights + 1 bias in the second."
      },
      {
        title: "Train, then inspect each prediction",
        text: "The loop should now look familiar. `optimizer.zero_grad()` replaces our manual gradient clearing; `optimizer.step()` replaces the manual subtraction. The model starts in training mode, then switches to evaluation mode for inference.\n\n`model.eval()` changes the behavior of certain layers, such as dropout; it does not turn gradient tracking off. That is why we also use `torch.no_grad()`. Our simple Linear/Tanh network has no dropout, but this is a useful habit.\n\nAt inference time, sigmoid turns a logit into a value between 0 and 1. We interpret this as the model's estimated probability of class 1 and use a 0.5 threshold. A confident score is not a guarantee that a model is correct.",
        code: `model.train()
for epoch in range(400):
    optimizer.zero_grad()
    logits = model(X)
    assert logits.shape == y.shape
    loss = loss_fn(logits, y)
    loss.backward()
    optimizer.step()
    if epoch % 100 == 0:
        print(f"Epoch {epoch:3d} | loss before update: {loss.item():.4f}")

model.eval()
with torch.no_grad():
    probabilities = torch.sigmoid(model(X))
    predictions = (probabilities >= 0.5).float()
    accuracy = (predictions == y).float().mean().item()
for inputs, probability, predicted, target in zip(X, probabilities, predictions, y):
    print(inputs.tolist(), f"p(1)={probability.item():.3f}",
          "prediction=", int(predicted.item()), "target=", int(target.item()))
print(f"Training accuracy: {accuracy:.0%}")`,
        check: "With the supplied seed and settings, expect predictions 0, 1, 1, 0 and 100% training accuracy. Exact probabilities can vary across PyTorch versions. This only proves the tiny training table was learned."
      }
    ],
    assignments: [
      {title: "Remove the activation", task: "Create a fresh model with just Linear(2, 8) and Linear(8, 1), recreate the optimizer, and train again. Compare the predictions and loss with the original network. Explain why extra linear layers alone cannot solve XOR.", hint: "When you replace a model, the old optimizer still refers to the old parameters. Create a new optimizer for the new model."},
      {title: "Try a smaller hidden layer", task: "Compare 2, 4, and 8 hidden neurons. Reset the seed, model, and optimizer for each experiment. Record parameter count, training loss, and all four predictions; do not claim that every initialization will converge.", hint: "Change both Linear(2, hidden_size) and Linear(hidden_size, 1). With h hidden neurons, there are 4*h + 1 parameters."}
    ],
    takeaway: "You have trained a real, small neural network. Nonlinearity lets it learn XOR; a separate evaluation is needed to judge unseen data.",
    references: ["networks", "optimization"]
  },
  {
    slug: "deep-learning-6-test-save-and-experiment", title: "Test it, save it, make it yours", time: "45–60 min", runtime: "pytorch",
    description: "Finish a small classifier with separate training, validation, and test examples, then save and reload its learned weights.",
    goal: "Complete a reproducible mini-project and distinguish fitting training data from doing well on unseen examples.",
    sections: [
      {
        title: "Give the network examples it has not seen",
        text: "Our final project classifies two-dimensional points: class 1 when their coordinates have opposite signs, otherwise class 0. This is a continuous cousin of XOR. The rule generates our teaching labels; the network does not receive the rule as an input.\n\nWe create 400 synthetic examples, then use a fixed random permutation to split them into **training** (240), **validation** (80), and **test** (80). Training examples drive parameter updates. Validation examples help choose settings such as hidden size or epoch count. Test examples are reserved for the final evaluation.\n\nThese are independent synthetic points from one simple distribution. Success here does not establish performance on photographs, language, or real-world decisions. For real datasets, also watch for duplicate examples and related people, time periods, or sources leaking across splits.",
        code: `import torch
from torch import nn

torch.manual_seed(7)
X = torch.rand(400, 2) * 2 - 1
y = (X[:, 0] * X[:, 1] < 0).float().reshape(-1, 1)
order = torch.randperm(len(X))
train_ids, val_ids, test_ids = order[:240], order[240:320], order[320:]
X_train, y_train = X[train_ids], y[train_ids]
X_val, y_val = X[val_ids], y[val_ids]
X_test, y_test = X[test_ids], y[test_ids]
print("Split sizes:", len(X_train), len(X_val), len(X_test))`,
        check: "The split sizes must be 240, 80, and 80. Splitting happens before training, and only X_train/y_train will be passed to the training loss."
      },
      {
        title: "Use validation to understand learning",
        text: "We use the same model shape as the XOR lesson, with 16 hidden neurons for this larger set. Set the main experimental choices near the top: hidden size, learning rate, and epochs.\n\nThe helper function measures loss and accuracy without updating parameters. Accuracy counts how many thresholded predictions match the targets; loss also reflects the scores behind those decisions.\n\n**Overfitting** happens when fitting the training examples does not translate to unseen data. Falling training loss alongside rising validation loss is a warning sign. This clean toy dataset may not show strong overfitting, and we should not pretend it does. Compare the actual measurements you get.",
        code: `hidden_size = 16
learning_rate = 0.03
epochs = 400
model = nn.Sequential(nn.Linear(2, hidden_size), nn.Tanh(), nn.Linear(hidden_size, 1))
loss_fn = nn.BCEWithLogitsLoss()
optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

def evaluate(inputs, targets):
    model.eval()
    with torch.no_grad():
        logits = model(inputs)
        loss = loss_fn(logits, targets).item()
        predicted = (torch.sigmoid(logits) >= 0.5).float()
        accuracy = (predicted == targets).float().mean().item()
    return loss, accuracy

history = []
for epoch in range(epochs):
    model.train()
    optimizer.zero_grad()
    loss = loss_fn(model(X_train), y_train)
    loss.backward()
    optimizer.step()
    if (epoch + 1) % 100 == 0:
        train_loss, train_accuracy = evaluate(X_train, y_train)
        val_loss, val_accuracy = evaluate(X_val, y_val)
        history.append((epoch + 1, train_loss, val_loss))
        print(f"Epoch {epoch + 1} | train loss {train_loss:.3f} | "
              f"val loss {val_loss:.3f} | val accuracy {val_accuracy:.1%}")`,
        check: "You should see four progress reports. Record the validation results before opening the final test section. If you change a setting, rerun the notebook from the top so the data, initialization, and optimizer start fresh."
      },
      {
        title: "Do a final test and preserve what you learned",
        text: "Choose your settings using validation first. Then run this section once for a final test report. If you repeatedly tune based on the test result, it is no longer an untouched test.\n\nWe save a **state dictionary** containing learned parameters, plus the hidden size needed to recreate the architecture. A new model loads those parameters and should make the same predictions. This is an inference checkpoint, not a full training-resume checkpoint: resuming Adam training would also require its optimizer state.\n\nThe file is written as `room310_tiny_net.pt` in your runtime's working directory. In Colab, download it from the Files sidebar before the runtime resets. Only load model files you trust; our example reloads the file it just created.",
        code: `test_loss, test_accuracy = evaluate(X_test, y_test)
print(f"Final test | loss {test_loss:.3f} | accuracy {test_accuracy:.1%}")

torch.save({"hidden_size": hidden_size, "model_state": model.state_dict()},
           "room310_tiny_net.pt")
checkpoint = torch.load("room310_tiny_net.pt", map_location="cpu", weights_only=True)
restored = nn.Sequential(
    nn.Linear(2, checkpoint["hidden_size"]), nn.Tanh(),
    nn.Linear(checkpoint["hidden_size"], 1),
)
restored.load_state_dict(checkpoint["model_state"])
restored.eval()
with torch.no_grad():
    assert torch.allclose(model(X_test), restored(X_test))
    new_points = torch.tensor([[-0.8, 0.7], [0.7, 0.6]])
    probabilities = torch.sigmoid(restored(new_points))
print("Reload check passed. New p(class 1):", probabilities.flatten().tolist())`,
        check: "The reload assertion should pass. The two new points have true labels 1 and 0. Inspect the model's scores rather than assuming they must be right. Test accuracy is a measurement, not a guaranteed target."
      }
    ],
    assignments: [
      {title: "Your mini-project report", task: "Compare hidden sizes 4 and 16 using validation only. For each run, start from the top and record the seed, learning rate, epoch count, final train loss, validation loss, and validation accuracy. Choose one configuration, report its final test accuracy, and save its checkpoint.", hint: "Keep all settings except hidden size the same. If you already used the test set for tuning, say so and generate a fresh independent final test set."},
      {title: "Explain what you built", task: "Write five sentences: what the inputs and labels represent; what the layers do; how loss and gradients change parameters; how you prevented test leakage; and one limitation of the model. Include two new-point predictions and the saved file.", hint: "Passing a reload check proves the weights were restored, not that the classifier is accurate. Keep those two claims separate."}
    ],
    takeaway: "You can now build, train, evaluate, and reload a small PyTorch network—and explain what its results do and do not prove.",
    references: ["saving", "optimization", "inspiration"]
  }
];
