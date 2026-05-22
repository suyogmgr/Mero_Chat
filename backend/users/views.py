# from django.shortcuts import render, redirect
# from django.contrib.auth import login, authenticate, logout
# from django.contrib.auth.models import User
# from django.contrib import messages
# from .forms import RegistrationForm

# def register_view(request):
#     if request.user.is_authenticated:
#         return redirect('chat_home')  # Your chat home URL
    
#     if request.method == 'POST':
#         form = RegistrationForm(request.POST)
#         if form.is_valid():
#             user = form.save()
#             login(request, user)
#             messages.success(request, 'Account created successfully!')
#             return redirect('chat_home')
#     else:
#         form = RegistrationForm()
    
#     return render(request, 'auth/register.html', {'form': form})

# def login_view(request):
#     if request.user.is_authenticated:
#         return redirect('chat_home')
    
#     if request.method == 'POST':
#         username = request.POST.get('username')
#         password = request.POST.get('password')
#         user = authenticate(request, username=username, password=password)
        
#         if user is not None:
#             login(request, user)
#             next_url = request.GET.get('next', 'chat_home')
#             return redirect(next_url)
#         else:
#             messages.error(request, 'Invalid username or password')
    
#     return render(request, 'auth/login.html')

# def logout_view(request):
#     logout(request)
#     messages.success(request, 'Logged out successfully!')
#     return redirect('login')


from django.shortcuts import render, redirect
from django.contrib.auth import login, authenticate, logout
from django.contrib import messages
from .forms import RegistrationForm

def register_view(request):
    if request.user.is_authenticated:
        return redirect('chat_home')
    
    if request.method == 'POST':
        form = RegistrationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            messages.success(request, f'Welcome to MeroChat, {user.username}!')
            return redirect('chat_home')
        else:
            # Add form errors as messages
            for field, errors in form.errors.items():
                for error in errors:
                    messages.error(request, f"{field}: {error}")
    else:
        form = RegistrationForm()
    
    return render(request, 'auth/register.html', {'form': form})

def login_view(request):
    if request.user.is_authenticated:
        return redirect('chat_home')
    
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        user = authenticate(request, username=username, password=password)
        
        if user is not None:
            login(request, user)
            messages.success(request, f'Welcome back, {user.username}!')
            next_url = request.GET.get('next', 'chat_home')
            return redirect(next_url)
        else:
            messages.error(request, 'Invalid username or password')
    
    return render(request, 'auth/login.html')

def logout_view(request):
    logout(request)
    messages.success(request, 'You have been logged out.')
    return redirect('login')