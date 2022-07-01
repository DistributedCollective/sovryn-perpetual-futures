import numpy as np

def mymedian(a,b,c):
    if (a>b and b>=c) or (a<b and b<=c):
        return b
    if (a>c and c>=b) or (a<c and c<=b):  
        return c
    return a


if __name__ == '__main__':
    N = int(1e3)
    print("Start with N=", N)
    for k in range(N):
        v = 10*np.random.rand(3)-5
        a = np.median((v[0], v[1], v[2]))
        b = mymedian(v[0],v[1],v[2])
        if a!=b:
            print("NP m =", a)
            print("my m =", b)
            print("values = ", v)
print("no more differences found")

print(mymedian(1,2,2))
print(np.median((1,2,2)))
print("--")
print(mymedian(2,1,2))
print(np.median((2,1,2)))
print("--")
print(mymedian(2,2,1))
print(np.median((2,2,1)))
print("--")
print(mymedian(1,1,1))
print(np.median((1,1,1)))
print("--")
print(mymedian(-1,-1,1))
print(np.median((-1,-1,1)))
print("--")
print(mymedian(-1,-1,1))
print(np.median((-1,-1,1)))
print("--")
print(mymedian(3,2,2))
print(np.median((3,2,2)))
print("--")
print(mymedian(2,3,2))
print(np.median((2,3,2)))
print("--")
print(mymedian(2,2,3))
print(np.median((2,2,3)))
print("--")
print(mymedian(0,0,3))
print(np.median((0,0,3)))
print("--")
print(mymedian(0,3,4))
print(np.median((0,3,4)))